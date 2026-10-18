import { describe, expect, it } from 'vitest';
import { resolveBrowserProvider } from './planner-provider';

describe('browser provider billing', () => {
  it('does not turn ChatGPT plan text into an OpenAI API request', () => {
    expect(() =>
      resolveBrowserProvider(
        { provider: 'chatgpt', accountId: 'account-1', model: 'gpt-test' },
        undefined,
        undefined,
      ),
    ).toThrow(/not sent to the OpenAI API/);
  });

  it('uses the API only after an explicit OpenAI override', () => {
    expect(
      resolveBrowserProvider(
        { provider: 'chatgpt', accountId: 'account-1', model: 'gpt-test' },
        'openai',
        undefined,
      ),
    ).toEqual({ provider: 'openai' });
  });
});
