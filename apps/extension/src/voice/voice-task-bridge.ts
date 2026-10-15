import type { VoiceEvent } from '@nudge/contracts';

export interface VoiceTaskBridgeDependencies {
  submitTurn(text: string): void;
  stopTask(): void;
  reportIntent(name: string, argumentsValue: Record<string, unknown>, callId: string): void;
}

export function createVoiceTaskBridge(dependencies: VoiceTaskBridgeDependencies) {
  return (event: VoiceEvent): void => {
    if (event.type === 'transcript' && event.role === 'user' && event.final) {
      if (/^(stop|stop task|cancel)$/i.test(event.text.trim())) dependencies.stopTask();
      else dependencies.submitTurn(event.text);
    }
    if (event.type === 'function.intent') {
      dependencies.reportIntent(event.name, event.arguments, event.callId);
    }
  };
}
