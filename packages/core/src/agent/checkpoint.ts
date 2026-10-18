import type {
  AuthorizationRecord,
  ExtractedRecord,
  TaskMemory,
  TaskStatus,
} from '@nudge/contracts';

import { addIssue, appendStep } from './memory';
import { redactText } from './redaction';

export interface Checkpoint {
  version: 1;
  taskId: string;
  status: TaskStatus;
  memory: TaskMemory;
  authorization: AuthorizationRecord;
  records: ExtractedRecord[];
  generation: number;
  instructionVersion: number;
  inFlight?: { tool: string; fingerprint: string } | undefined;
  boundTabId?: number | undefined;
  provider?: 'openai' | 'ollama' | undefined;
}

export interface CheckpointInput {
  taskId: string;
  memory: TaskMemory;
  status: TaskStatus;
  authorization: AuthorizationRecord;
  records: ExtractedRecord[];
  generation: number;
  instructionVersion: number;
  inFlight?: { tool: string; fingerprint: string } | undefined;
  boundTabId?: number | undefined;
  provider?: 'openai' | 'ollama' | undefined;
}

const safe = (text: string) => redactText(text).slice(0, 2_000);

export function toCheckpoint(input: CheckpointInput): Checkpoint {
  const memory: TaskMemory = {
    ...input.memory,
    goal: safe(input.memory.goal),
    userData: input.memory.userData
      .filter((item) => !item.sensitive)
      .map((item) => ({ ...item, value: safe(item.value) })),
    steps: input.memory.steps.map((step) => ({
      ...step,
      summary: safe(step.summary),
      ...(step.evidence ? { evidence: safe(step.evidence) } : {}),
    })),
    issues: input.memory.issues.map(safe),
    constraints: input.memory.constraints.map((constraint) => ({
      ...constraint,
      text: safe(constraint.text),
    })),
  };
  return {
    ...(input.provider ? { provider: input.provider } : {}),
    version: 1,
    taskId: input.taskId,
    status: input.status,
    memory,
    authorization: { ...input.authorization, instruction: safe(input.authorization.instruction) },
    records: input.records,
    generation: input.generation,
    instructionVersion: input.instructionVersion,
    ...(input.inFlight ? { inFlight: input.inFlight } : {}),
    ...(input.boundTabId !== undefined ? { boundTabId: input.boundTabId } : {}),
  };
}

export function restoreCheckpoint(checkpoint: Checkpoint): {
  status: 'paused';
  memory: TaskMemory;
  uncertain: string[];
} {
  let memory = checkpoint.memory;
  const uncertain: string[] = [];
  if (checkpoint.inFlight) {
    uncertain.push(checkpoint.inFlight.tool);
    memory = appendStep(memory, {
      tool: checkpoint.inFlight.tool,
      summary: `${checkpoint.inFlight.tool} was in progress when Nudge restarted; outcome unknown.`,
      ok: false,
      uncertain: true,
    });
    memory = addIssue(
      memory,
      `Verify before continuing: ${checkpoint.inFlight.tool} may or may not have happened.`,
    );
  }
  memory = addIssue(memory, 'Nudge restarted; it will look at the page again before acting.');
  return { status: 'paused', memory, uncertain };
}
