// Adapted from https://nexus-ui.dev/docs/components/tool.
import * as Collapsible from '@radix-ui/react-collapsible';
import { AlertCircle, Check, ChevronDown, Circle, LoaderCircle } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';

export type ToolStatus = 'pending' | 'ready' | 'running' | 'completed' | 'error';
const ToolContext = createContext<{ status: ToolStatus }>({ status: 'pending' });

const labels: Record<ToolStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  running: 'Running',
  completed: 'Completed',
  error: 'Error',
};

export function Tool({
  status,
  defaultOpen,
  open,
  onOpenChange,
  children,
  className,
}: {
  status: ToolStatus;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Collapsible.Root
      className={className ? `nudge-tool ${className}` : 'nudge-tool'}
      data-status={status}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <ToolContext.Provider value={{ status }}>{children}</ToolContext.Provider>
    </Collapsible.Root>
  );
}

export function ToolTrigger({ name, className }: { name: string; className?: string }) {
  const { status } = useContext(ToolContext);
  const Icon =
    status === 'completed' ? Check : status === 'error' ? AlertCircle : status === 'running' ? LoaderCircle : Circle;
  return (
    <Collapsible.Trigger className={className ? `nudge-tool__trigger ${className}` : 'nudge-tool__trigger'}>
      <Icon size={15} aria-hidden="true" className={status === 'running' ? 'toast-spin' : undefined} />
      <span>{name}</span>
      <small>{labels[status]}</small>
      <ChevronDown size={14} aria-hidden="true" />
    </Collapsible.Trigger>
  );
}

export function ToolContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Collapsible.Content className={className ? `nudge-tool__content ${className}` : 'nudge-tool__content'}>
      {children}
    </Collapsible.Content>
  );
}

export function ToolInput({ payload }: { payload: unknown }) {
  return (
    <pre className="nudge-tool__payload">
      <span>Input</span>
      {formatPayload(payload)}
    </pre>
  );
}

export function ToolOutput({
  payload,
  errorText,
  showWhen = ['completed'],
}: {
  payload?: unknown;
  errorText?: string;
  showWhen?: ToolStatus[];
}) {
  const { status } = useContext(ToolContext);
  if (!showWhen.includes(status)) return null;
  if (status === 'error' && errorText) return <p className="nudge-tool__error">{errorText}</p>;
  if (payload === undefined) return null;
  return (
    <pre className="nudge-tool__payload">
      <span>Output</span>
      {formatPayload(payload)}
    </pre>
  );
}

function formatPayload(payload: unknown) {
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}
