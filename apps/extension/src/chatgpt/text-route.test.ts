import { describe, expect, it } from 'vitest';
import { planMessages, routeEligibleText, voiceBilling } from './text-route';

describe('ChatGPT text routing', () => {
  it('sends eligible text to the plan and refuses a silent API fallback for browser work', () => {
    const selection = { provider: 'chatgpt' as const, accountId: 'account-1', model: 'gpt-test' };
    expect(routeEligibleText({ text: 'What did I say about my CV?', selection })).toEqual({
      kind: 'plan',
      accountId: 'account-1',
      model: 'gpt-test',
    });
    expect(routeEligibleText({ text: 'Open the jobs page and apply', selection })).toEqual({
      kind: 'browser',
    });
    expect(routeEligibleText({ text: 'Summarize this paragraph', selection: { provider: 'openai' } })).toEqual({
      kind: 'conversation',
      provider: 'openai',
    });
  });

  it('does not mix a conversation across ChatGPT accounts', () => {
    expect(
      planMessages({
        history: [{ role: 'user', text: 'Earlier' }],
        question: 'Continue',
        boundAccountId: 'account-a',
        activeAccountId: 'account-b',
      }).ok,
    ).toBe(false);
    expect(
      planMessages({
        history: [{ role: 'assistant', text: 'Saved locally' }],
        question: 'Hello',
        activeAccountId: 'account-a',
      }),
    ).toMatchObject({ ok: true, messages: [{ role: 'assistant' }, { role: 'user', content: 'Hello' }] });
  });

  it('keeps voice on API billing when text uses the ChatGPT plan', () => {
    expect(voiceBilling({ provider: 'chatgpt', accountId: 'account-1', model: 'gpt-test' })).toBe('api');
    expect(voiceBilling({ provider: 'openai' })).toBe('api');
    expect(
      voiceBilling({ provider: 'ollama', model: 'qwen', baseUrl: 'http://127.0.0.1:11434' }),
    ).toBe('local');
  });
});
