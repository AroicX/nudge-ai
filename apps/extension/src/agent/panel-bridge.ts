import { PanelMessageSchema, type ControllerMessage, type ControllerSnapshot } from '@nudge/contracts';

export interface PortLike {
  name: string;
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
export function createPanelBridge(controller: ControllerSurface) {
  const ports = new Set<PortLike>();
  const post = (port: PortLike, message: ControllerMessage) => {
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
            return;
          case 'instruct':
            void controller.instruct(message.text, message.source, message.originTabId);
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
