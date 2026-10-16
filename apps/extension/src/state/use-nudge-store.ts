import type {
  ControllerSnapshot,
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
  controller: ControllerSnapshot | undefined;
  exports: Array<{ filename: string; url: string }>;
  capabilityReason: string | undefined;
  setController(snapshot: ControllerSnapshot): void;
  addExport(file: { filename: string; url: string }): void;
  setCapabilityReason(reason: string | undefined): void;
  setBusy(busy: boolean): void;
  setStatus(status: string): void;
  addTurn(turn: ConversationTurn | PersistedTurn): void;
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
  controller: undefined,
  exports: [],
  capabilityReason: undefined,
  setController: (controller) =>
    set((state) => {
      const timeline = controller.timeline.length ? controller.timeline : state.timeline;
      if (controller.timeline.length) void historyStore.saveHistory({ version: 1, turns: state.conversation, timeline });
      return {
        controller,
        timeline,
        busy: ['planning', 'running', 'waiting_for_page'].includes(controller.status),
      };
    }),
  addExport: (file) => set((state) => ({ exports: [...state.exports, file].slice(-10) })),
  setCapabilityReason: (capabilityReason) => set({ capabilityReason }),
  setBusy: (busy) => set({ busy }),
  setStatus: (status) => set({ status }),
  addTurn: (turn) =>
    set((state) => {
      const conversation = [...state.conversation, { ...turn, sources: 'sources' in turn ? turn.sources : [] }];
      void historyStore.saveHistory({ version: 1, turns: conversation, timeline: state.timeline });
      return { conversation };
    }),
  hydrateHistory: async () => {
    const history = await historyStore.loadHistory();
    set({ conversation: history.turns, timeline: history.timeline });
  },
  addAction: (action) => set((state) => ({ actions: [...state.actions, action] })),
  setTask: (task) => set({ task }),
  clearHistory: async () => {
    await historyStore.clearHistory();
    set({ conversation: [], timeline: [], actions: [], task: null, status: 'Ready' });
  },
  setVoiceState: (voiceState) => set({ voiceState }),
  setVoiceTranscript: (voiceTranscript) => set({ voiceTranscript }),
  setTimelineStep: (step) =>
    set((state) => {
      const timeline = [...state.timeline.filter((item) => item.id !== step.id), step].slice(-100);
      void historyStore.saveHistory({ version: 1, turns: state.conversation, timeline });
      return { timeline };
    }),
}));
