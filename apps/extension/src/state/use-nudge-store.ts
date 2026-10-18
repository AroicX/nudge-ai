import type {
  ControllerSnapshot,
  ActionResult,
  ConversationTurn,
  PersistedTurn,
  TaskState,
  VoiceSessionState,
  TimelineStep,
  SourceReference,
} from '@nudge/contracts';
import { create } from 'zustand';
import { historyStore } from '../history/history-store';

interface NudgeState {
  pendingTaskTurnId?: string | undefined;
  busy: boolean;
  status: string;
  conversation: PersistedTurn[];
  actions: ActionResult[];
  task: TaskState | null;
  voiceState: VoiceSessionState;
  voiceTranscript: string;
  liveVoiceTurn?: { role: 'user' | 'assistant'; text: string } | undefined;
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
  patchTurn(id: string, text: string): void;
  setTurnSources(id: string, sources: SourceReference[]): void;
  hydrateHistory(): Promise<void>;
  subscribeHistory(): () => void;
  replaceConversation(turns: PersistedTurn[]): void;
  addAction(action: ActionResult): void;
  setTask(task: TaskState | null): void;
  clearHistory(): Promise<void>;
  setVoiceState(state: VoiceSessionState): void;
  setVoiceTranscript(text: string): void;
  setLiveVoiceTurn(turn: { role: 'user' | 'assistant'; text: string } | undefined): void;
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
      const taskChanged = controller.taskId !== state.controller?.taskId;
      const timeline =
        controller.timeline.length || taskChanged ? controller.timeline : state.timeline;
      let conversation = state.conversation;
      if (controller.taskId && controller.status !== 'idle') {
        const existingIndex = conversation.findIndex(
          (turn) => turn.progress?.taskId === controller.taskId,
        );
        // Late updates for an already-known task must never migrate to a later message.
        const index =
          existingIndex >= 0
            ? existingIndex
            : taskChanged
              ? conversation.findIndex((turn) => turn.id === state.pendingTaskTurnId)
              : -1;
        if (index >= 0) {
          const progress: NonNullable<PersistedTurn['progress']> = {
            taskId: controller.taskId,
            status: controller.status,
            ...(controller.startedAt !== undefined ? { startedAt: controller.startedAt } : {}),
            ...(controller.completedAt !== undefined
              ? { completedAt: controller.completedAt }
              : {}),
            steps: controller.timeline,
          };
          conversation = conversation.map((turn, turnIndex) =>
            turnIndex === index ? { ...turn, progress } : turn,
          );
        }
      }
      if (conversation !== state.conversation || controller.timeline.length) {
        void historyStore.saveHistory({ version: 1, turns: conversation, timeline });
      }
      return {
        controller,
        pendingTaskTurnId: taskChanged ? undefined : state.pendingTaskTurnId,
        conversation,
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
      if (state.conversation.some((existing) => existing.id === turn.id)) return {};
      const conversation = [
        ...state.conversation,
        { ...turn, sources: 'sources' in turn ? turn.sources : [] },
      ];
      void historyStore.saveHistory({ version: 1, turns: conversation, timeline: state.timeline });
      return { conversation, ...(turn.role === 'user' ? { pendingTaskTurnId: turn.id } : {}) };
    }),
  patchTurn: (id, text) =>
    set((state) => {
      const next = text.slice(0, 4000);
      if (!next || !state.conversation.some((turn) => turn.id === id)) return {};
      const conversation = state.conversation.map((turn) =>
        turn.id === id ? { ...turn, text: next } : turn,
      );
      void historyStore.saveHistory({ version: 1, turns: conversation, timeline: state.timeline });
      return { conversation };
    }),
  setTurnSources: (id, sources) =>
    set((state) => {
      if (!state.conversation.some((turn) => turn.id === id)) return {};
      const conversation = state.conversation.map((turn) =>
        turn.id === id ? { ...turn, sources } : turn,
      );
      void historyStore.saveHistory({ version: 1, turns: conversation, timeline: state.timeline });
      return { conversation };
    }),
  replaceConversation: (conversation) =>
    set({
      conversation,
      timeline: [],
      actions: [],
      pendingTaskTurnId: undefined,
      exports: [],
      status: 'Ready',
    }),
  subscribeHistory: () =>
    historyStore.subscribe((history) => {
      set({ conversation: history.turns, timeline: history.timeline });
    }),
  hydrateHistory: async () => {
    const history = await historyStore.loadHistory();
    set({ conversation: history.turns, timeline: history.timeline });
  },
  addAction: (action) => set((state) => ({ actions: [...state.actions, action] })),
  setTask: (task) => set({ task }),
  clearHistory: async () => {
    await historyStore.clearHistory();
    set({
      conversation: [],
      timeline: [],
      actions: [],
      task: null,
      pendingTaskTurnId: undefined,
      status: 'Ready',
    });
  },
  setVoiceState: (voiceState) => set({ voiceState }),
  setVoiceTranscript: (voiceTranscript) => set({ voiceTranscript }),
  setLiveVoiceTurn: (liveVoiceTurn) => set({ liveVoiceTurn }),
  setTimelineStep: (step) =>
    set((state) => {
      const timeline = [...state.timeline.filter((item) => item.id !== step.id), step].slice(-100);
      void historyStore.saveHistory({ version: 1, turns: state.conversation, timeline });
      return { timeline };
    }),
}));
