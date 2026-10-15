import type { AgentStepRequest } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { OpenAIDecisionProvider } from './openai-provider';

const request: AgentStepRequest = {
  requestId: 'req_1',
  taskId: 'task_1',
  cancellationGeneration: 0,
  utterance: 'Read this page',
  conversation: [],
  page: {
    snapshotId: 'snap_1',
    documentId: 'doc_1',
    capturedAt: '2026-10-15T18:00:00.000Z',
    url: 'https://example.test/',
    title: 'Example',
    viewport: { width: 1200, height: 800, scrollX: 0, scrollY: 0, pageHeight: 800 },
    elements: [],
    text: ['Example'],
    truncated: false,
    inaccessible: [],
  },
  task: null,
};

describe('OpenAIDecisionProvider', () => {
  it('uses the configured model and a strict decision tool', async () => {
    const create = vi.fn().mockResolvedValue({
      output: [
        {
          type: 'function_call',
          name: 'emit_decision',
          arguments: JSON.stringify({
            requestId: 'req_1',
            task: {
              id: 'task_1',
              goal: 'Read this page',
              intent: 'inspect',
              constraints: [],
              successConditions: ['Page content is available'],
              missingRequiredInformation: [],
              risk: 'low',
              status: 'active',
              cancellationGeneration: 0,
              verifiedActions: [],
              boundTabId: 0,
              boundDocumentId: 'doc_1',
            },
            decision: {
              type: 'act',
              taskId: 'task_1',
              action: { type: 'read_page' },
              expectedOutcome: 'Fresh page state',
            },
          }),
        },
      ],
    });
    const provider = new OpenAIDecisionProvider({ responses: { create } }, 'configured-model');

    const result = await provider.step(request, new AbortController().signal);

    expect(result.requestId).toBe('req_1');
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: 'configured-model',
      parallel_tool_calls: false,
      tool_choice: { type: 'function', name: 'emit_decision' },
      tools: [{ type: 'function', name: 'emit_decision', strict: true }],
    });
    const body = create.mock.calls[0]?.[0];
    expect(JSON.stringify(body)).not.toContain('"oneOf"');
    expect(JSON.stringify(body)).not.toContain('"format"');
  });

  it('rejects schema-invalid tool output', async () => {
    const create = vi.fn().mockResolvedValue({
      output: [
        { type: 'function_call', name: 'emit_decision', arguments: '{"requestId":"req_1"}' },
      ],
    });
    const provider = new OpenAIDecisionProvider({ responses: { create } }, 'configured-model');

    await expect(provider.step(request, new AbortController().signal)).rejects.toThrow(
      'OpenAI returned an invalid Nudge decision',
    );
  });
});
