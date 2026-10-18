import { describe, expect, it, vi } from 'vitest';
import { VoiceProviderGate } from './voice-provider-gate';

describe('voice provider hydration', () => {
  it('does not invoke either audio provider before the saved preference is loaded', () => {
    const gate = new VoiceProviderGate();
    const cloud = vi.fn();
    const local = vi.fn();
    const start = () => (gate.requireLocal() ? local : cloud)();
    expect(start).toThrow('waiting for your saved provider');
    expect(cloud).not.toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
    gate.set({ provider: 'ollama', model: 'qwen3.5:9b', baseUrl: 'http://127.0.0.1:11434' });
    start();
    expect(local).toHaveBeenCalledOnce();
    expect(cloud).not.toHaveBeenCalled();
  });
});

it('suspends audio immediately during a provider switch and rejects overlapping switches', () => {
  const gate = new VoiceProviderGate();
  gate.set({ provider: 'openai' });
  expect(gate.requireLocal()).toBe(false);
  expect(gate.beginSwitch()).toBe(true);
  expect(gate.ready).toBe(false);
  expect(() => gate.requireLocal()).toThrow();
  expect(gate.beginSwitch()).toBe(false);
  // A late settings hydration cannot re-enable the old audio provider.
  gate.set({ provider: 'openai' });
  expect(gate.ready).toBe(false);
  gate.finishSwitch({ provider: 'ollama', model: 'qwen3.5:9b', baseUrl: 'http://127.0.0.1:11434' });
  expect(gate.requireLocal()).toBe(true);
});

it('fails closed after a failed switch and allows an explicit retry', () => {
  const gate = new VoiceProviderGate();
  gate.set({ provider: 'openai' });
  gate.beginSwitch();
  gate.finishSwitch();
  expect(gate.ready).toBe(false);
  expect(() => gate.requireLocal()).toThrow();
  expect(gate.beginSwitch()).toBe(true);
  gate.finishSwitch({ provider: 'ollama', model: 'qwen3.5:9b', baseUrl: 'http://127.0.0.1:11434' });
  expect(gate.requireLocal()).toBe(true);
});
