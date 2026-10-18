import { describe, expect, it, vi } from 'vitest';

import { OllamaPlanner } from './ollama-planner';
import { OpenAIPlanner, toStrictSchema } from './openai-planner';
import { ScriptedPlanner } from './scripted-planner';
import { plannerRequest, SCREENSHOT } from './test-fixtures';

const frame = {
  screenshotId: 'shot_1',
  tabId: 4,
  documentId: 'doc_1',
  url: 'http://127.0.0.1:4173/jobs',
  capturedAt: 1,
  viewport: { cssWidth: 1200, cssHeight: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  imageWidth: 1200,
  imageHeight: 800,
  coordinateSpace: 'css_viewport' as const,
  mutationCounterAtCapture: 0,
};

function openAIReturning(args: unknown) {
  const create = vi.fn().mockResolvedValue({
    output: [{ type: 'function_call', name: 'emit_step', arguments: JSON.stringify(args) }],
  });
  return { create, planner: new OpenAIPlanner({ responses: { create } }, 'gpt-test') };
}

describe('OpenAIPlanner', () => {
  it('sends a strict emit_step tool and an image only when a screenshot is present', async () => {
    const { create, planner } = openAIReturning({
      requestId: 'req_1',
      planUpdate: null,
      riskLabel: null,
      expectation: null,
      toolCall: { tool: 'click', tabId: 4, elementId: 'doc_1:1' },
    });
    await planner.plan(plannerRequest(), new AbortController().signal);
    const body = create.mock.calls[0]![0];
    expect(body.model).toBe('gpt-test');
    expect(body.tools[0]).toMatchObject({ type: 'function', name: 'emit_step', strict: true });
    expect(body.tool_choice).toEqual({ type: 'function', name: 'emit_step' });
    expect(
      body.input[0].content.filter((part: { type: string }) => part.type === 'input_image'),
    ).toHaveLength(0);

    const withShot = plannerRequest();
    withShot.observation!.screenshot = { frame, dataUrl: SCREENSHOT };
    await planner.plan(withShot, new AbortController().signal);
    const content = create.mock.calls[1]![0].input[0].content;
    expect(content.filter((part: { type: string }) => part.type === 'input_image')).toEqual([
      { type: 'input_image', image_url: SCREENSHOT, detail: 'auto' },
    ]);
    expect(content[0].text).not.toContain('base64');
  });

  it('strips nulls the strict schema forces and validates the tool call', async () => {
    const { planner } = openAIReturning({
      requestId: 'req_1',
      planUpdate: null,
      riskLabel: null,
      expectation: null,
      toolCall: {
        tool: 'scroll',
        tabId: 4,
        direction: 'down',
        amount: 'viewport',
        elementId: null,
      },
    });
    const response = await planner.plan(plannerRequest(), new AbortController().signal);
    expect(response.toolCall).toEqual({
      tool: 'scroll',
      tabId: 4,
      direction: 'down',
      amount: 'viewport',
    });
  });

  it('rejects an invalid tool call from the model', async () => {
    const { planner } = openAIReturning({
      requestId: 'req_1',
      toolCall: { tool: 'eval', code: 'x' },
    });
    await expect(planner.plan(plannerRequest(), new AbortController().signal)).rejects.toThrow(
      /invalid/i,
    );
  });

  it('builds a strict schema where every object property is required and records are removed', () => {
    const schema = toStrictSchema({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
        c: {
          anyOf: [
            { type: 'array', items: { type: 'string' } },
            { type: 'object', additionalProperties: { type: 'string' } },
          ],
        },
      },
      required: ['a'],
      additionalProperties: false,
    }) as { required: string[]; properties: Record<string, { anyOf?: unknown[] }> };
    expect(schema.required).toEqual(['a', 'b', 'c']);
    expect(schema.properties.b!.anyOf).toEqual([{ type: 'number' }, { type: 'null' }]);
    expect(JSON.stringify(schema)).not.toContain('"additionalProperties":{');
  });
});

describe('OllamaPlanner', () => {
  const json = (value: unknown) =>
    Promise.resolve({ ok: true, json: async () => value } as Response);

  it('teaches the local tool API and accepts concise steps without model-authored correlation IDs', async () => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(json({ capabilities: ['completion', 'tools'] }))
      .mockReturnValueOnce(
        json({
          message: {
            content: JSON.stringify({
              toolCall: { tool: 'click', tabId: 4, elementId: 'local:1' },
            }),
          },
        }),
      );
    const planner = new OllamaPlanner('http://127.0.0.1:11434', 'qwen3.5:9b', fetcher);
    const result = await planner.plan(plannerRequest(), new AbortController().signal);
    const body = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(body.messages[0].content).toContain('Available tool argument structures');
    expect(body.format.properties).not.toHaveProperty('planUpdate');
    expect(body.format.properties).not.toHaveProperty('requestId');
    expect(result.requestId).toBe('req_1');
    expect(result.toolCall).toEqual({ tool: 'click', tabId: 4, elementId: 'doc_1:1' });
    expect(JSON.parse(body.messages[1].content).observation.snapshot.elements[0].id).toBe(
      'local:1',
    );
  });

  it('disables thinking for browser decisions while preserving structured output and cancellation', async () => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(json({ capabilities: ['completion', 'tools', 'vision', 'thinking'] }))
      .mockReturnValueOnce(
        json({
          message: {
            content: JSON.stringify({ requestId: 'model_id', toolCall: { tool: 'list_tabs' } }),
          },
        }),
      );
    const planner = new OllamaPlanner('http://127.0.0.1:11434', 'qwen3.5:9b', fetcher);
    const signal = new AbortController().signal;

    const result = await planner.plan(plannerRequest(), signal);

    const body = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(body).toMatchObject({
      model: 'qwen3.5:9b',
      think: false,
      stream: false,
      keep_alive: '2m',
      options: { num_ctx: 8192, num_predict: 1024 },
      format: { type: 'object' },
    });
    expect(fetcher.mock.calls[1]![1].signal).toBe(signal);
    expect(result).toEqual({ requestId: 'req_1', toolCall: { tool: 'list_tabs' } });
  });

  it('disables thinking when scoping a task and injects the correlation ID locally', async () => {
    const fetcher = vi.fn().mockReturnValueOnce(
      json({
        message: {
          content: JSON.stringify({
            goal: 'Collect jobs',
            proposal: {
              origins: 'browse_web',
              categories: ['read', 'navigate'],
              destinations: [],
              exclusions: [],
              limits: {},
            },
          }),
        },
      }),
    );
    const planner = new OllamaPlanner('http://127.0.0.1:11434', 'qwen3.5:9b', fetcher);

    const result = await planner.scope(
      { requestId: 'scope_1', instruction: 'Find frontend jobs', tabs: [] },
      new AbortController().signal,
    );

    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({
      think: false,
      format: { type: 'object' },
    });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).format.properties).not.toHaveProperty(
      'requestId',
    );
    expect(result).toMatchObject({
      requestId: 'scope_1',
      goal: 'Collect jobs',
      proposal: { categories: ['read', 'navigate', 'fill'] },
    });
  });

  it('reports local timing metadata without page text or model content', async () => {
    const timing = vi.fn();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(json({ capabilities: ['completion', 'tools'] }))
      .mockReturnValueOnce(
        json({
          message: { content: JSON.stringify({ toolCall: { tool: 'list_tabs' } }) },
          total_duration: 1000000000,
          load_duration: 1000000,
          prompt_eval_duration: 200000000,
          eval_duration: 700000000,
          prompt_eval_count: 200,
          eval_count: 50,
        }),
      );
    await new OllamaPlanner('http://127.0.0.1:11434', 'qwen3.5:9b', fetcher, timing).plan(
      plannerRequest(),
      new AbortController().signal,
    );
    expect(timing).toHaveBeenCalledWith({
      model: 'qwen3.5:9b',
      totalMs: 1000,
      loadMs: 1,
      promptMs: 200,
      generationMs: 700,
      promptTokens: 200,
      outputTokens: 50,
    });
  });

  it('omits the screenshot for a model without vision and notes it', async () => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(json({ capabilities: ['completion', 'tools'] }))
      .mockReturnValueOnce(
        json({
          message: {
            content: JSON.stringify({ requestId: 'req_1', toolCall: { tool: 'list_tabs' } }),
          },
        }),
      );
    const planner = new OllamaPlanner('http://127.0.0.1:11434', 'qwen3:8b', fetcher);
    const request = plannerRequest();
    request.observation!.screenshot = { frame, dataUrl: SCREENSHOT };
    await planner.plan(request, new AbortController().signal);
    const body = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(JSON.stringify(body)).not.toContain('base64');
    expect(body.messages[1].images).toBeUndefined();
    expect(body.messages[1].content).toContain('screenshot omitted: model lacks vision');
  });

  it('sends images to a vision model', async () => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(json({ capabilities: ['completion', 'tools', 'vision'] }))
      .mockReturnValueOnce(
        json({
          message: {
            content: JSON.stringify({ requestId: 'req_1', toolCall: { tool: 'list_tabs' } }),
          },
        }),
      );
    const planner = new OllamaPlanner('http://127.0.0.1:11434', 'llava', fetcher);
    const request = plannerRequest();
    request.observation!.screenshot = { frame, dataUrl: SCREENSHOT };
    await planner.plan(request, new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).messages[1].images).toEqual(['/9j/AAAA']);
  });

  it('refuses a model without tool support', async () => {
    const fetcher = vi.fn().mockReturnValueOnce(json({ capabilities: ['completion'] }));
    await expect(
      new OllamaPlanner('http://127.0.0.1:11434', 'tiny', fetcher).plan(
        plannerRequest(),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/tool/);
  });
});

describe('ScriptedPlanner', () => {
  const planner = new ScriptedPlanner({
    scenarios: [
      {
        match: 'frontend jobs',
        scope: {
          goal: 'Collect jobs',
          origins: 'browse_web',
          categories: ['read', 'navigate'],
          destinations: [],
          exclusions: [],
          limits: {},
          recordFields: ['title'],
        },
        steps: [
          {
            call: { tool: 'click', tabId: { byUrl: '/jobs' }, elementId: { byName: 'Next page' } },
          },
          { when: { textPresent: 'Never shown' }, call: { tool: 'list_tabs' } },
        ],
        versions: { '1': [{ call: { tool: 'activate_tab', tabId: { byUrl: '/sheet' } } }] },
      },
      {
        match: 'canvas',
        scope: {
          goal: 'Edit',
          origins: 'browse_web',
          categories: ['read', 'edit'],
          destinations: [],
          exclusions: [],
          limits: {},
        },
        steps: [
          {
            call: {
              tool: 'click_at',
              tabId: { bound: true },
              screenshotId: { latest: true },
              x: { relativeTo: { byName: 'Design canvas' }, offset: 20 },
              y: { relativeTo: { byName: 'Design canvas' }, offset: 30, axis: 'y' },
            },
          },
        ],
      },
    ],
  });

  it('resolves byName to an element id and byUrl to a tab id', async () => {
    const response = await planner.plan(plannerRequest(), new AbortController().signal);
    expect(response.toolCall).toEqual({ tool: 'click', tabId: 4, elementId: 'doc_1:1' });
  });

  it('waits when a step condition is unmet', async () => {
    const response = await planner.plan(
      plannerRequest({ requestId: 'req_2' }),
      new AbortController().signal,
    );
    expect(response.toolCall).toMatchObject({ tool: 'wait_for', condition: { kind: 'idle' } });
  });

  it('switches to the corrected script after an instruction change', async () => {
    const response = await planner.plan(
      plannerRequest({ instructionVersion: 1 }),
      new AbortController().signal,
    );
    expect(response.toolCall).toEqual({ tool: 'activate_tab', tabId: 5 });
  });

  it('resolves coordinates relative to an element and the latest screenshot', async () => {
    const base = plannerRequest();
    const request = plannerRequest({
      goal: 'Edit the canvas',
      taskId: 'task_canvas',
      authorization: { ...base.authorization, instruction: 'Edit the canvas' },
    });
    request.observation!.screenshot = { frame, dataUrl: SCREENSHOT };
    const response = await planner.plan(request, new AbortController().signal);
    expect(response.toolCall).toEqual({
      tool: 'click_at',
      tabId: 4,
      screenshotId: 'shot_1',
      x: 120,
      y: 80,
    });
  });

  it('returns the scenario scope', async () => {
    const scope = await planner.scope(
      { requestId: 's1', instruction: 'Find frontend jobs', tabs: [] },
      new AbortController().signal,
    );
    expect(scope).toMatchObject({ requestId: 's1', goal: 'Collect jobs', recordFields: ['title'] });
  });
});
