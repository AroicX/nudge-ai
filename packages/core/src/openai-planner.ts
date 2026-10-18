import {
  PlannerResponseSchema,
  ScopeResponseSchema,
  type PlannerRequest,
  type PlannerResponse,
  type ScopeRequest,
  type ScopeResponse,
} from '@nudge/contracts';
import { z } from 'zod';

import { PLANNER_INSTRUCTIONS, SCOPE_INSTRUCTIONS } from './instructions';


interface ResponsesClient {
  responses: {
    create(body: unknown, options?: { signal?: AbortSignal }): Promise<{ output?: unknown[] }>;
  };
}

const UNSUPPORTED_KEYS = new Set(['$schema', 'format', 'default', 'minLength', 'maxLength', 'propertyNames', 'exclusiveMinimum', 'exclusiveMaximum']);

/**
 * Convert a Zod-generated JSON schema to OpenAI strict function-calling form:
 * every property required, optional ones nullable, open records removed.
 */
export function toStrictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toStrictSchema);
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (UNSUPPORTED_KEYS.has(key)) continue;
    output[key === 'oneOf' ? 'anyOf' : key] = toStrictSchema(child);
  }
  if (Array.isArray(output.anyOf)) {
    const options = (output.anyOf as Record<string, unknown>[]).filter(
      (option) => !(option.type === 'object' && !option.properties && typeof option.additionalProperties === 'object'),
    );
    if (options.length === 1) {
      delete output.anyOf;
      Object.assign(output, options[0]);
    } else output.anyOf = options;
  }
  if (output.type === 'object' && output.properties && typeof output.properties === 'object') {
    const properties = output.properties as Record<string, unknown>;
    const required = new Set(Array.isArray(input.required) ? (input.required as string[]) : []);
    for (const [name, schema] of Object.entries(properties)) {
      if (!required.has(name)) {
        const existing = schema as Record<string, unknown>;
        properties[name] = Array.isArray(existing.anyOf)
          ? { ...existing, anyOf: [...(existing.anyOf as unknown[]), { type: 'null' }] }
          : { anyOf: [existing, { type: 'null' }] };
      }
    }
    output.required = Object.keys(properties);
    output.additionalProperties = false;
  }
  return output;
}

const PLAN_PARAMETERS = toStrictSchema(z.toJSONSchema(PlannerResponseSchema, { io: 'input', unrepresentable: 'any' }));
const SCOPE_PARAMETERS = toStrictSchema(z.toJSONSchema(ScopeResponseSchema, { io: 'input', unrepresentable: 'any' }));

function functionArguments(output: unknown[] | undefined, name: string): unknown {
  const call = output?.find(
    (item): item is { type: 'function_call'; name: string; arguments: string } =>
      typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'function_call' && (item as { name?: unknown }).name === name,
  );
  if (!call) {
    const summary = output?.map((item) => {
      const value = item as { type?: string; name?: string; namespace?: string };
      return { type: value.type, name: value.name, namespace: value.namespace };
    });
    throw new Error(`Provider did not return the ${name} tool call. Output: ${JSON.stringify(summary ?? [])}`);
  }
  try {
    return stripNulls(JSON.parse(call.arguments));
  } catch {
    throw new Error('OpenAI returned an invalid step: malformed JSON.');
  }
}

export class OpenAIPlanner  {
  constructor(
    private readonly client: ResponsesClient,
    private readonly model: string,
  ) {
    if (!model.trim()) throw new Error('OPENAI_AGENT_MODEL must be configured.');
  }

  async plan(request: PlannerRequest, signal: AbortSignal): Promise<PlannerResponse> {
    const screenshot = request.observation?.screenshot;
    const response = await this.client.responses.create(
      {
        model: this.model,
        instructions: PLANNER_INSTRUCTIONS,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: JSON.stringify(withoutScreenshotBytes(request)) },
              ...(screenshot ? [{ type: 'input_image', image_url: screenshot.dataUrl, detail: 'auto' }] : []),
            ],
          },
        ],
        parallel_tool_calls: false,
        tool_choice: { type: 'function', name: 'emit_step' },
        tools: [{ type: 'function', name: 'emit_step', description: 'Return the next Nudge tool call.', strict: true, parameters: PLAN_PARAMETERS }],
      },
      { signal },
    );
    const parsed = PlannerResponseSchema.safeParse(functionArguments(response.output, 'emit_step'));
    if (!parsed.success) throw new Error(`OpenAI returned an invalid step: ${z.prettifyError(parsed.error)}`);
    return { ...parsed.data, requestId: request.requestId };
  }

  async scope(request: ScopeRequest, signal: AbortSignal): Promise<ScopeResponse> {
    const response = await this.client.responses.create(
      {
        model: this.model,
        instructions: SCOPE_INSTRUCTIONS,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(request) }] }],
        parallel_tool_calls: false,
        tool_choice: { type: 'function', name: 'emit_scope' },
        tools: [{ type: 'function', name: 'emit_scope', description: 'Return the task scope.', strict: true, parameters: SCOPE_PARAMETERS }],
      },
      { signal },
    );
    const parsed = ScopeResponseSchema.safeParse(functionArguments(response.output, 'emit_scope'));
    if (!parsed.success) throw new Error(`OpenAI returned an invalid scope: ${z.prettifyError(parsed.error)}`);
    return { ...parsed.data, requestId: request.requestId };
  }

  async capabilities() {
    return { tools: true, vision: true };
  }
}

/** Remove JSON nulls produced by strict-mode optional fields so Zod sees absent keys. */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== null)
        .map(([key, child]) => [key, stripNulls(child)]),
    );
  }
  return value;
}

/** The planner never needs the image bytes inside the JSON text part. */
export function withoutScreenshotBytes(request: PlannerRequest): PlannerRequest {
  if (!request.observation?.screenshot) return request;
  const { screenshot, ...observation } = request.observation;
  return {
    ...request,
    observation: {
      ...observation,
      screenshot: { frame: screenshot.frame, dataUrl: 'data:image/jpeg;attached-separately' },
    },
  };
}

export function withoutScreenshot(request: PlannerRequest): PlannerRequest {
  if (!request.observation?.screenshot) return request;
  const observation = { ...request.observation };
  delete observation.screenshot;
  return { ...request, observation };
}
