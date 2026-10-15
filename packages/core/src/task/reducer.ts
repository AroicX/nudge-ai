import type { TaskConstraint, TaskState } from '@nudge/contracts';

export type TaskReducerEvent =
  | { type: 'start'; task: TaskState }
  | { type: 'modify'; constraints: TaskConstraint[]; successConditions?: string[] }
  | { type: 'clarify'; missingRequiredInformation: string[] }
  | { type: 'stop' }
  | { type: 'resume' }
  | { type: 'document_changed'; documentId: string };

export function reduceTask(state: TaskState | null, event: TaskReducerEvent): TaskState {
  if (event.type === 'start') return event.task;
  if (!state) throw new Error(`Cannot apply ${event.type} without an active task`);

  switch (event.type) {
    case 'modify': {
      const constraints = new Map(
        state.constraints.map((constraint) => [constraint.key, constraint]),
      );
      event.constraints.forEach((constraint) => constraints.set(constraint.key, constraint));
      return {
        ...state,
        constraints: [...constraints.values()],
        successConditions: event.successConditions ?? state.successConditions,
        missingRequiredInformation: [],
        status: 'active',
      };
    }
    case 'clarify':
      return {
        ...state,
        missingRequiredInformation: event.missingRequiredInformation,
        status: 'waiting_for_user',
      };
    case 'stop':
      return {
        ...state,
        cancellationGeneration: state.cancellationGeneration + 1,
        status: 'stopped',
      };
    case 'resume':
      return {
        ...state,
        cancellationGeneration: state.cancellationGeneration + 1,
        missingRequiredInformation: [],
        status: 'active',
      };
    case 'document_changed':
      return { ...state, boundDocumentId: event.documentId };
  }
}
