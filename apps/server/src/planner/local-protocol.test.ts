import { plannerRequest } from './test-fixtures';
import { describe, expect, it } from 'vitest';
import { ToolCallSchema } from '@nudge/contracts';
import { localPlanInstructions, localScopeInstructions, localStepFormat } from './local-protocol';

describe('local planner protocol', () => {
  it('teaches every existing tool and its arguments rather than relying on decoding grammar', () => {
    const prompt = localPlanInstructions();
    for (const option of ToolCallSchema.options) expect(prompt).toContain(option.shape.tool.value);
    expect(prompt).toContain('elementId');
    expect(prompt).toContain('replace');
    expect(prompt).toContain('toolCall');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('Never invent');
    expect(prompt.length).toBeLessThan(10000);
  });
  it('explains search and drafting permissions and does not invent collection limits', () => {
    const prompt = localScopeInstructions();
    expect(prompt).toContain('fill');
    expect(prompt).toContain('search');
    expect(prompt).toContain('limits:{}');
  });
});

it('uses a smaller matching grammar/catalog while retaining all general browser controls', () => {
  const request = plannerRequest();
  request.goal = 'Find the price on this page';
  request.authorization.instruction = request.goal;
  request.authorization.categories = ['read', 'navigate'];
  request.memory.recordFields = [];
  const prompt = localPlanInstructions(request);
  const format = localStepFormat(request) as {
    properties: { toolCall: { oneOf: Array<{ properties: { tool: { const: string } } }> } };
  };
  const tools = format.properties.toolCall.oneOf.map((item) => item.properties.tool.const);
  for (const tool of [
    'click',
    'type_text',
    'inspect_element',
    'hover',
    'drag',
    'wait_for',
    'open_tab',
    'activate_tab',
    'close_tab',
    'request_confirmation',
    'ask_user',
    'report_partial',
  ]) {
    expect(tools).toContain(tool);
    expect(prompt).toContain(`${tool}{`);
  }
  for (const tool of [
    'record_items',
    'export_records',
    'start_timed_repeat',
    'transfer_code',
    'click_at',
  ])
    expect(tools).not.toContain(tool);
  expect(prompt.length).toBeLessThan(localPlanInstructions().length);
  expect(prompt.length).toBeLessThan(5000);
});

it('restores specialized tools from explicit scope and current screenshot inputs', () => {
  const request = plannerRequest();
  request.goal = 'Collect a table; repeat every 5 seconds and transfer a verification code';
  request.authorization.instruction = request.goal;
  request.observation!.screenshot = { dataUrl: 'data:image/jpeg;base64,AA==', frame: {} as never };
  const prompt = localPlanInstructions(request);
  for (const tool of [
    'record_items',
    'export_records',
    'start_timed_repeat',
    'transfer_code',
    'click_at',
  ])
    expect(prompt).toContain(`${tool}{`);
});

it('does not let model-authored scope turn a factual answer into a records task', () => {
  const request = plannerRequest();
  request.authorization.instruction = 'What is the price and battery life?';
  request.authorization.categories.push('create_records');
  request.memory.recordFields = ['price', 'battery'];
  request.goal = 'Record price and battery life';
  expect(JSON.stringify(localStepFormat(request))).not.toContain('record_items');
});

it('keeps routine form prompts small and restores general recovery after failure', () => {
  const request = plannerRequest();
  request.authorization.instruction =
    'Replace the email address in this form with ada@example.test. Do not submit.';
  request.memory.constraints = [];
  const prompt = localPlanInstructions(request);
  expect(prompt.length).toBeLessThan(2400);
  expect(prompt).toContain('type_text{');
  expect(prompt).toContain('ask_user{');
  expect(prompt).toContain('Never submit/send');
  expect(prompt).not.toContain('focus{');
  expect(prompt).toContain('automatically focuses');
  expect(JSON.stringify(localStepFormat(request))).not.toContain('"focus"');
  expect(prompt).not.toContain('open_tab{');
  expect(JSON.stringify(localStepFormat(request))).not.toContain('open_tab');
  request.lastResult = { tool: 'type_text', ok: false, detail: 'Changed page' };
  expect(localPlanInstructions(request)).toContain('open_tab{');
});
