import type { VoiceEvent, VoiceToolResult } from '@nudge/contracts';

export interface VoiceTaskBridgeDependencies {
  runBrowserTask(goal: string): Promise<VoiceToolResult>;
  returnResult(callId: string, result: VoiceToolResult): void;
  stopTask(): void;
}

export function createVoiceTaskBridge(dependencies: VoiceTaskBridgeDependencies) {
  const calls = new Map<string, Promise<VoiceToolResult>>();

  return async (event: VoiceEvent): Promise<void> => {
    if (event.type === 'transcript' && event.role === 'user' && event.final) {
      if (/^(stop|stop task|cancel)$/i.test(event.text.trim())) dependencies.stopTask();
      return;
    }
    if (event.type !== 'function.intent') return;

    const goal = event.arguments.goal;
    if (
      event.name !== 'run_browser_task' ||
      typeof goal !== 'string' ||
      !goal.trim() ||
      goal.length > 2_000
    ) {
      dependencies.returnResult(event.callId, {
        ok: false,
        message: 'I could not understand the browser task.',
      });
      return;
    }

    let resultPromise = calls.get(event.callId);
    if (!resultPromise) {
      resultPromise = dependencies.runBrowserTask(goal.trim()).catch((error: unknown) => ({
        ok: false,
        message:
          error instanceof Error && error.message
            ? error.message.slice(0, 1_000)
            : 'The browser task could not be completed.',
      }));
      calls.set(event.callId, resultPromise);
      if (calls.size > 200) calls.delete(calls.keys().next().value!);
    }
    dependencies.returnResult(event.callId, await resultPromise);
  };
}
