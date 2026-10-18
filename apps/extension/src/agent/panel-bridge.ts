import {
  PanelMessageSchema,
  type ControllerMessage,
  type ControllerSnapshot,
  type ScheduledTask,
} from '@nudge/contracts';

export interface PortLike {
  name: string;
  sender?: { url?: string };
  postMessage(message: unknown): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface ControllerSurface {
  instruct(text: string, source: 'text' | 'voice', originTabId?: number): Promise<void>;
  control(action: 'stop' | 'pause' | 'resume' | 'continue_budget'): void;
  confirm(previewId: string, approved: boolean): void;
  answer(text: string): void;
  capabilityGranted(): void;
  approveFallback(approved: boolean): void;
  requestExport(format: 'csv' | 'xlsx'): Promise<void>;
  snapshot(): ControllerSnapshot;
}

/** Background side of the side-panel Port. Validates every panel message before it reaches the controller. */
export function createPanelBridge(
  controller: ControllerSurface,
  schedules?: {
    ready: Promise<void>;
    instruct(text: string, originTabId?: number): Promise<boolean>;
    snapshot(): ScheduledTask[];
    cancel(id: string): Promise<void>;
    manage?(id: string, action: 'run' | 'delete' | 'update', changes: { instruction?: string; runAt?: number }): Promise<void>;
  },
) {
  const ports = new Set<PortLike>();
  const fullPage = (port: PortLike) => {
    try { const url = new URL(port.sender?.url ?? ''); return url.protocol === 'chrome-extension:' && url.pathname === '/sidepanel.html' && url.searchParams.get('view') === 'fullpage'; }
    catch { return false; }
  };
  const post = (port: PortLike, message: ControllerMessage) => {
    if (message.type === 'schedules' && !fullPage(port)) return;
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  };
  return {
    connect(port: PortLike): void {
      if (port.name !== 'nudge-panel') return;
      ports.add(port);
      port.onDisconnect.addListener(() => ports.delete(port));
      port.onMessage.addListener((raw) => {
        const parsed = PanelMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        const message = parsed.data;
        switch (message.type) {
          case 'hello':
            post(port, { type: 'state', task: controller.snapshot() });
            if (schedules)
              void schedules.ready.then(() =>
                post(port, { type: 'schedules', jobs: schedules.snapshot() }),
              );
            return;
          case 'instruct':
            if (schedules)
              void schedules.ready
                .then(async () => {
                  if (!(await schedules.instruct(message.text, message.originTabId)))
                    await controller.instruct(message.text, message.source, message.originTabId);
                })
                .catch(() =>
                  post(port, {
                    type: 'milestone',
                    text: 'Could not save or start the task. Please try again.',
                  }),
                );
            else void controller.instruct(message.text, message.source, message.originTabId);
            return;
          case 'cancel_schedule':
            if (!fullPage(port)) { post(port, { type: 'milestone', text: 'Open Nudge full-screen to manage scheduled tasks.' }); return; }
            if (schedules)
              void schedules.ready
                .then(() => schedules.cancel(message.id))
                .catch(() =>
                  post(port, {
                    type: 'milestone',
                    text: 'Could not cancel the scheduled task. Please try again.',
                  }),
                );
            return;
          case 'manage_schedule':
            if (!fullPage(port)) { post(port, { type: 'milestone', text: 'Open Nudge full-screen to manage scheduled tasks.' }); return; }
            if (schedules?.manage) void schedules.ready.then(() => schedules.manage!(message.id, message.action, { ...(message.instruction !== undefined ? { instruction: message.instruction } : {}), ...(message.runAt !== undefined ? { runAt: message.runAt } : {}) })).catch((error) => post(port, { type: 'milestone', text: error instanceof Error ? error.message : 'Could not update the scheduled task.' }));
            return;
          case 'control':
            controller.control(message.action);
            return;
          case 'confirm':
            controller.confirm(message.previewId, message.approved);
            return;
          case 'answer':
            controller.answer(message.text);
            return;
          case 'capability_granted':
            controller.capabilityGranted();
            return;
          case 'approve_fallback':
            controller.approveFallback(message.approved);
            return;
          case 'request_export':
            void controller.requestExport(message.format);
            return;
        }
      });
    },
    emit(message: ControllerMessage): void {
      for (const port of [...ports]) post(port, message);
    },
  };
}
