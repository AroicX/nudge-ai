import type {
  ActionResult,
  AgentStepRequest,
  AgentStepResponse,
  BrowserAction,
  ConversationTurn,
  PageSnapshot,
  TaskState,
  TimelineStep,
} from '@nudge/contracts';
import { CancellationGate, evaluateAction } from '@nudge/core';

export interface RunTaskInput {
  tabId: number;
  utterance: string;
  conversation: ConversationTurn[];
  task: TaskState | null;
}

export interface RunTaskDependencies {
  observe(signal: AbortSignal): Promise<PageSnapshot>;
  step(request: AgentStepRequest, signal: AbortSignal): Promise<AgentStepResponse>;
  execute(
    action: BrowserAction,
    guard: { tabId: number; documentId: string; cancellationGeneration: number },
    signal: AbortSignal,
  ): Promise<ActionResult>;
  onStatus?: (status: string) => void;
  onAction?: (result: ActionResult) => void;
  onMessage?: (message: string) => void;
  onTimelineStep?: (step: TimelineStep) => void;
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
        const page = await dependencies.observe(controller.signal);
        gate.assertActive(generation);
        timeline({ id: observeId, label: 'Read the current page', status: 'completed' });

        const decideId = `${generation}:decide:${stepCount}`;
        timeline({ id: decideId, label: 'Choosing the next safe action', status: 'active' });
        dependencies.onStatus?.('Working on it…');
        const requestId = crypto.randomUUID();
        const response = await dependencies.step(
          {
            requestId,
            taskId: task?.id ?? crypto.randomUUID(),
            cancellationGeneration: generation,
            utterance: input.utterance,
            conversation: input.conversation,
            page,
            task,
          },
          controller.signal,
        );
        gate.assertActive(generation);
        timeline({ id: decideId, label: 'Chose the next safe action', status: 'completed' });
        task = {
          ...response.task,
          cancellationGeneration: generation,
          boundTabId: input.tabId,
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
          const reason = 'Cross-tab switching is not available in this build yet.';
          dependencies.onStatus?.(reason);
          return { status: 'failed', reason };
        }

        const policy = evaluateAction(
          {
            task,
            tabId: input.tabId,
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
            tabId: input.tabId,
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
