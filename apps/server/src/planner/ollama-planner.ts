import {
  PlannerResponseSchema,
  ScopeResponseSchema,
  type PlannerRequest,
  type PlannerResponse,
  type ScopeRequest,
  type ScopeResponse,
} from '@nudge/contracts';
import { z } from 'zod';

import { OllamaDecisionProvider } from '../providers/ollama-provider';
import { PLANNER_INSTRUCTIONS, SCOPE_INSTRUCTIONS } from './instructions';
import { stripNulls, withoutScreenshot, type PlannerProvider } from './planner-provider';

type Fetcher = typeof fetch;

export class OllamaPlanner implements PlannerProvider {
  #capabilities: Promise<{ tools: boolean; vision: boolean }> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  capabilities() {
    this.#capabilities ??= OllamaDecisionProvider.capabilities(this.baseUrl, this.model, this.fetcher);
    return this.#capabilities;
  }

  async #chat(system: string, content: string, images: string[] | undefined, schema: unknown, signal: AbortSignal): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: schema,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content, ...(images ? { images } : {}) },
        ],
      }),
      signal,
    });
    if (!response.ok) throw new Error('Ollama chat request failed.');
    const body = (await response.json()) as { message?: { content?: unknown } };
    if (typeof body.message?.content !== 'string') throw new Error('Ollama returned an invalid step.');
    try {
      return stripNulls(JSON.parse(body.message.content));
    } catch {
      throw new Error('Ollama returned malformed JSON.');
    }
  }

  async plan(request: PlannerRequest, signal: AbortSignal): Promise<PlannerResponse> {
    const capabilities = await this.capabilities();
    if (!capabilities.tools) throw new Error('The selected Ollama model does not support tool decisions.');
    const screenshot = request.observation?.screenshot;
    let sendable = withoutScreenshot(request);
    let images: string[] | undefined;
    if (screenshot && capabilities.vision) {
      images = [screenshot.dataUrl.replace(/^data:image\/\w+;base64,/, '')];
      sendable = { ...sendable, observation: { ...sendable.observation!, screenshot: { frame: screenshot.frame, dataUrl: 'data:image/jpeg;attached' } } };
    } else if (screenshot) {
      sendable = { ...sendable, notes: [...sendable.notes, 'screenshot omitted: model lacks vision'].slice(-20) };
    }
    const value = await this.#chat(PLANNER_INSTRUCTIONS, JSON.stringify(sendable), images, z.toJSONSchema(PlannerResponseSchema, { io: 'input', unrepresentable: 'any' }), signal);
    const parsed = PlannerResponseSchema.safeParse(value);
    if (!parsed.success) throw new Error(`Ollama returned an invalid step: ${z.prettifyError(parsed.error)}`);
    return { ...parsed.data, requestId: request.requestId };
  }

  async scope(request: ScopeRequest, signal: AbortSignal): Promise<ScopeResponse> {
    const value = await this.#chat(SCOPE_INSTRUCTIONS, JSON.stringify(request), undefined, z.toJSONSchema(ScopeResponseSchema, { io: 'input', unrepresentable: 'any' }), signal);
    const parsed = ScopeResponseSchema.safeParse(value);
    if (!parsed.success) throw new Error(`Ollama returned an invalid scope: ${z.prettifyError(parsed.error)}`);
    return { ...parsed.data, requestId: request.requestId };
  }
}
