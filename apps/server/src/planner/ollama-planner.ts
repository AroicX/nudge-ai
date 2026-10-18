import {
  PlannerResponseSchema,
  ScopeResponseSchema,
  type PlannerRequest,
  type PlannerResponse,
  type ScopeRequest,
  type ScopeResponse,
} from '@nudge/contracts';
import { z } from 'zod';

import { directNavigationPlan, directNavigationScope } from './direct-navigation';
import { OllamaDecisionProvider } from '../providers/ollama-provider';
import { serializeCompactPlannerRequest } from './compact-request';
import { normalizeLocalScope } from './local-scope';
import { routineFormScope } from './routine-form';
import { aliasPlannerElements } from './element-aliases';
import {
  localPlanInstructions,
  localScopeInstructions,
  localStepFormat,
  LOCAL_SCOPE_FORMAT,
} from './local-protocol';
import { stripNulls, withoutScreenshot, type PlannerProvider } from './planner-provider';

type Fetcher = typeof fetch;
export interface LocalInferenceTiming {
  model: string;
  totalMs: number;
  loadMs: number;
  promptMs: number;
  generationMs: number;
  promptTokens: number;
  outputTokens: number;
}

export class OllamaPlanner implements PlannerProvider {
  // Cold 9B prompt processing can exceed two minutes; cancellation remains immediate.
  readonly requestTimeoutMs = 180_000;
  #capabilities: Promise<{ tools: boolean; vision: boolean }> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly onTiming?: (timing: LocalInferenceTiming) => void,
  ) {}

  capabilities() {
    this.#capabilities ??= OllamaDecisionProvider.capabilities(
      this.baseUrl,
      this.model,
      this.fetcher,
    ).catch((error: unknown) => {
      this.#capabilities = undefined;
      throw error;
    });
    return this.#capabilities;
  }

  async #chat(
    system: string,
    content: string,
    images: string[] | undefined,
    schema: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        // Routine scope and browser decisions should not spend time generating reasoning traces.
        think: false,
        stream: false,
        keep_alive: '2m',
        options: { num_ctx: 8192, num_predict: 1024, temperature: 0 },
        format: schema,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content, ...(images ? { images } : {}) },
        ],
      }),
      signal,
    });
    if (!response.ok) throw new Error('Ollama chat request failed.');
    const body = (await response.json()) as {
      message?: { content?: unknown };
      total_duration?: number;
      load_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const number = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
    this.onTiming?.({
      model: this.model,
      totalMs: number(body.total_duration) / 1e6,
      loadMs: number(body.load_duration) / 1e6,
      promptMs: number(body.prompt_eval_duration) / 1e6,
      generationMs: number(body.eval_duration) / 1e6,
      promptTokens: number(body.prompt_eval_count),
      outputTokens: number(body.eval_count),
    });
    if (typeof body.message?.content !== 'string')
      throw new Error('Ollama returned an invalid step.');
    try {
      return stripNulls(JSON.parse(body.message.content));
    } catch {
      throw new Error('Ollama returned malformed JSON.');
    }
  }

  async plan(request: PlannerRequest, signal: AbortSignal): Promise<PlannerResponse> {
    signal.throwIfAborted();
    const direct = directNavigationPlan(request);
    if (direct) return direct;
    const capabilities = await this.capabilities();
    if (!capabilities.tools)
      throw new Error('The selected Ollama model does not support tool decisions.');
    const screenshot = request.observation?.screenshot;
    let sendable = withoutScreenshot(request);
    let images: string[] | undefined;
    if (screenshot && capabilities.vision) {
      images = [screenshot.dataUrl.replace(/^data:image\/\w+;base64,/, '')];
      sendable = {
        ...sendable,
        observation: {
          ...sendable.observation!,
          screenshot: { frame: screenshot.frame, dataUrl: 'data:image/jpeg;attached' },
        },
      };
    } else if (screenshot) {
      sendable = {
        ...sendable,
        notes: [...sendable.notes, 'screenshot omitted: model lacks vision'].slice(-20),
      };
    }
    const aliases = aliasPlannerElements(sendable);
    const value = aliases.restore(
      await this.#chat(
        localPlanInstructions(aliases.request),
        serializeCompactPlannerRequest(aliases.request),
        images,
        localStepFormat(aliases.request),
        signal,
      ),
    );
    const parsed = PlannerResponseSchema.safeParse(
      value && typeof value === 'object' ? { ...value, requestId: request.requestId } : value,
    );
    if (!parsed.success)
      throw new Error(`Ollama returned an invalid step: ${z.prettifyError(parsed.error)}`);
    return { ...parsed.data, requestId: request.requestId };
  }

  async scope(request: ScopeRequest, signal: AbortSignal): Promise<ScopeResponse> {
    signal.throwIfAborted();
    const direct = directNavigationScope(request);
    if (direct) return direct;
    const form = routineFormScope(request);
    if (form) return form;
    const value = await this.#chat(
      localScopeInstructions(),
      JSON.stringify(request),
      undefined,
      LOCAL_SCOPE_FORMAT,
      signal,
    );
    const parsed = ScopeResponseSchema.safeParse(
      value && typeof value === 'object' ? { ...value, requestId: request.requestId } : value,
    );
    if (!parsed.success)
      throw new Error(`Ollama returned an invalid scope: ${z.prettifyError(parsed.error)}`);
    return normalizeLocalScope(request, parsed.data);
  }
}
