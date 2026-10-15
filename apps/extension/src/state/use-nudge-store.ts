import type {
  ActionResult,
  ConversationTurn,
  TaskState,
  VoiceSessionState,
} from '@nudge/contracts';
import { create } from 'zustand';

interface NudgeState {
  busy: boolean;
  status: string;
  conversation: ConversationTurn[];
  actions: ActionResult[];
  task: TaskState | null;
  voiceState: VoiceSessionState;
  voiceTranscript: string;
  setBusy(busy: boolean): void;
  setStatus(status: string): void;
  addTurn(turn: ConversationTurn): void;
  addAction(action: ActionResult): void;
  setTask(task: TaskState | null): void;
  clearHistory(): void;
  setVoiceState(state: VoiceSessionState): void;
  setVoiceTranscript(text: string): void;
}

export const useNudgeStore = create<NudgeState>((set) => ({
  busy: false,
  status: 'Ready',
  conversation: [],
  actions: [],
  task: null,
  voiceState: 'idle',
  voiceTranscript: '',
  setBusy: (busy) => set({ busy }),
  setStatus: (status) => set({ status }),
  addTurn: (turn) => set((state) => ({ conversation: [...state.conversation, turn] })),
  addAction: (action) => set((state) => ({ actions: [...state.actions, action] })),
  setTask: (task) => set({ task }),
  clearHistory: () => set({ conversation: [], actions: [], task: null, status: 'Ready' }),
  setVoiceState: (voiceState) => set({ voiceState }),
  setVoiceTranscript: (voiceTranscript) => set({ voiceTranscript }),
}));
