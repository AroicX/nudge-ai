import type {
  ActionResult,
  ConversationTurn,
  PersistedTurn,
  TaskState,
  VoiceSessionState,
  TimelineStep,
} from '@nudge/contracts';
import { create } from 'zustand';
import { historyStore } from '../history/history-store';

interface NudgeState {
  busy: boolean;
  status: string;
  conversation: PersistedTurn[];
  actions: ActionResult[];
  task: TaskState | null;
  voiceState: VoiceSessionState;
  voiceTranscript: string;
  timeline: TimelineStep[];
  setBusy(busy: boolean): void;
  setStatus(status: string): void;
  addTurn(turn: ConversationTurn): void;
  hydrateHistory(): Promise<void>;
  addAction(action: ActionResult): void;
  setTask(task: TaskState | null): void;
  clearHistory(): Promise<void>;
  setVoiceState(state: VoiceSessionState): void;
  setVoiceTranscript(text: string): void;
  setTimelineStep(step: TimelineStep): void;
}

export const useNudgeStore = create<NudgeState>((set) => ({
  busy: false,
  status: 'Ready',
  conversation: [],
  actions: [],
  task: null,
  voiceState: 'idle',
  voiceTranscript: '',
  timeline: [],
  setBusy: (busy) => set({ busy }),
  setStatus: (status) => set({ status }),
  addTurn: (turn) =>
    set((state) => {
      const conversation = [...state.conversation, { ...turn, sources: [] }];
      void historyStore.saveHistory({ version: 1, turns: conversation, timeline: [] });
      return { conversation };
    }),
  hydrateHistory: async () => {
    const history = await historyStore.loadHistory();
    set({ conversation: history.turns });
  },
  addAction: (action) => set((state) => ({ actions: [...state.actions, action] })),
  setTask: (task) => set({ task }),
  clearHistory: async () => {
    await historyStore.clearHistory();
    set({ conversation: [], actions: [], task: null, status: 'Ready' });
  },
  setVoiceState: (voiceState) => set({ voiceState }),
  setVoiceTranscript: (voiceTranscript) => set({ voiceTranscript }),
  setTimelineStep: (step) =>
    set((state) => ({
      timeline: [...state.timeline.filter((item) => item.id !== step.id), step].slice(-100),
    })),
}));
