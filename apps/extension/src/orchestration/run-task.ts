import type {
  ActionResult,
  AgentStepRequest,
  AgentStepResponse,
  BrowserAction,
  ConversationTurn,
  PageSnapshot,
  TaskState,
  TimelineStep,
  BrowserContext,
  SourceReference,
} from '@nudge/contracts';
import { CancellationGate, evaluateAction } from '@nudge/core';
import type { ProviderFallbackController, ProviderFallbackRequest } from './provider-fallback';

export interface RunTaskInput {
  tabId: number;
  utterance: string;
  conversation: ConversationTurn[];
  task: TaskState | null;
  provider?: 'openai' | 'ollama';
  browserContext?: BrowserContext;
}

export interface RunTaskDependencies {
  observe(signal: AbortSignal, tabId?: number): Promise<PageSnapshot>;
  step(
    request: AgentStepRequest,
    signal: AbortSignal,
    provider?: 'openai' | 'ollama',
  ): Promise<AgentStepResponse>;
  execute(
    action: BrowserAction,
    guard: { tabId: number; documentId: string; cancellationGeneration: number },
    signal: AbortSignal,
  ): Promise<ActionResult>;
  onStatus?: (status: string) => void;
  onAction?: (result: ActionResult) => void;
  onMessage?: (message: string, sources?: SourceReference[]) => void;
  onTimelineStep?: (step: TimelineStep) => void;
  fallback?: ProviderFallbackController;
  onFallbackRequest?: (request: ProviderFallbackRequest) => void;
  switchTab?: (tabId: number, signal: AbortSignal) => Promise<void>;
}

export interface TaskRunHandle {
  stop(): void;
  done: Promise<TaskState | { status: 'stopped' | 'failed'; reason?: string }>;
}

export function runTask(input: RunTaskInput, dependencies: RunTaskDependencies): TaskRunHandle {
  const controller = new AbortController();
  const gate = new CancellationGate();
  const generation = gate.generation;

  const done = (async (): Promise<
    TaskState | { status: 'stopped' | 'failed'; reason?: string }
  > => {
    let task = input.task;
    let currentTabId = input.tabId;
    let activeTimeline: TimelineStep | undefined;
    const timeline = (step: TimelineStep) => {
      activeTimeline = step;
      dependencies.onTimelineStep?.(step);
    };
    try {
      for (let stepCount = 0; stepCount < 12; stepCount += 1) {
        const observeId = `${generation}:observe:${stepCount}`;
        timeline({ id: observeId, label: 'Reading the current page', status: 'active' });
        dependencies.onStatus?.('Reading this page…');
        const page = await dependencies.observe(controller.signal, currentTabId);
        gate.assertActive(generation);
        timeline({ id: observeId, label: 'Read the current page', status: 'completed' });

        const decideId = `${generation}:decide:${stepCount}`;
        timeline({ id: decideId, label: 'Choosing the next safe action', status: 'active' });
        dependencies.onStatus?.('Working on it…');
        const requestId = crypto.randomUUID();
        const stepRequest = {
            requestId,
            taskId: task?.id ?? crypto.randomUUID(),
            cancellationGeneration: generation,
            utterance: input.utterance,
            conversation: input.conversation,
            page,
            task,
            ...(input.browserContext
              ? { browserContext: { ...input.browserContext, currentTabId } }
              : {}),
          } satisfies AgentStepRequest;
        let response: AgentStepResponse;
        try {
          response = await dependencies.step(stepRequest, controller.signal, input.provider);
        } catch (error) {
          if (input.provider !== 'ollama' || !dependencies.fallback) throw error;
          const reason = error instanceof Error ? error.message : 'Ollama could not complete this step.';
          timeline({ id: decideId, label: 'Ollama needs help', status: 'error', detail: reason });
          const pending = dependencies.fallback.request(stepRequest.taskId, reason);
          dependencies.onFallbackRequest?.(pending.request);
          if ((await pending.decision) !== 'approved') {
            return { status: 'failed', reason: 'OpenAI fallback was not approved.' };
          }
          timeline({ id: decideId, label: 'Retrying this step with approved OpenAI access', status: 'active' });
          response = await dependencies.step(stepRequest, controller.signal, 'openai');
        }
        gate.assertActive(generation);
        timeline({ id: decideId, label: 'Chose the next safe action', status: 'completed' });
        task = {
          ...response.task,
          cancellationGeneration: generation,
          boundTabId: currentTabId,
          boundDocumentId: page.documentId,
        };

        if (response.decision.type === 'finish') {
          dependencies.onMessage?.(response.decision.message);
          dependencies.onStatus?.('Done');
          return task;
        }
        if (response.decision.type === 'ask_user') {
          dependencies.onMessage?.(response.decision.question);
          dependencies.onStatus?.('Waiting for you');
          return task;
        }
        if (response.decision.type === 'switch_tab') {
          const decision = response.decision;
          const target = input.browserContext?.tabs.find(
            (candidate) => candidate.tabId === decision.tabId && !candidate.discarded,
          );
          if (!target || !dependencies.switchTab) {
            const reason = 'The requested browser tab is not available.';
            dependencies.onStatus?.(reason);
            return { status: 'failed', reason };
          }
          const switchId = `${generation}:switch:${stepCount}`;
          timeline({ id: switchId, label: decision.reason, status: 'active', sources: [target] });
          await dependencies.switchTab(target.tabId, controller.signal);
          gate.assertActive(generation);
          currentTabId = target.tabId;
          timeline({ id: switchId, label: `Switched to ${target.title}`, status: 'completed', sources: [target] });
          continue;
        }

        const policy = evaluateAction(
          {
            task,
            tabId: currentTabId,
            documentId: page.documentId,
            observedUrls: page.elements.flatMap((element) => (element.href ? [element.href] : [])),
          },
          response.decision.action,
        );
        if (policy.decision !== 'allow') {
          dependencies.onMessage?.(policy.reason);
          return { status: 'failed', reason: policy.reason };
        }

        dependencies.onStatus?.(response.decision.narration ?? 'Taking the next step…');
        const result = await dependencies.execute(
          response.decision.action,
          {
            tabId: currentTabId,
            documentId: page.documentId,
            cancellationGeneration: generation,
          },
          controller.signal,
        );
        gate.assertActive(generation);
        dependencies.onAction?.(result);
        if (!result.ok) {
          if (result.detail.toLowerCase().includes('stale')) continue;
          return { status: 'failed', reason: result.detail };
        }
      }
      return { status: 'failed', reason: 'Nudge reached its safe step limit.' };
    } catch (error) {
      if (activeTimeline) {
        timeline({ ...activeTimeline, status: 'error', detail: error instanceof Error ? error.message : 'Task failed.' });
      }
      if (controller.signal.aborted) return { status: 'stopped' };
      return { status: 'failed', reason: error instanceof Error ? error.message : 'Task failed.' };
    }
  })();

  return {
    stop() {
      gate.stop();
      controller.abort();
      dependencies.onStatus?.('Stopped');
    },
    done,
  };
}
