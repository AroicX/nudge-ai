import type { ActionResult, ConversationTurn, TaskState } from '@nudge/contracts';
import { create } from 'zustand';

interface NudgeState {
  busy: boolean;
  status: string;
  conversation: ConversationTurn[];
  actions: ActionResult[];
  task: TaskState | null;
  setBusy(busy: boolean): void;
  setStatus(status: string): void;
  addTurn(turn: ConversationTurn): void;
  addAction(action: ActionResult): void;
  setTask(task: TaskState | null): void;
  clearHistory(): void;
}

export const useNudgeStore = create<NudgeState>((set) => ({
  busy: false,
  status: 'Ready',
  conversation: [],
  actions: [],
  task: null,
  setBusy: (busy) => set({ busy }),
  setStatus: (status) => set({ status }),
  addTurn: (turn) => set((state) => ({ conversation: [...state.conversation, turn] })),
  addAction: (action) => set((state) => ({ actions: [...state.actions, action] })),
  setTask: (task) => set({ task }),
  clearHistory: () => set({ conversation: [], actions: [], task: null, status: 'Ready' }),
}));
