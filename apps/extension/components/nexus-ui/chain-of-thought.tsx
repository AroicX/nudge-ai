import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { Alert02Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import * as React from 'react';

import { useOnChange } from '../../src/lib/use-on-change';
import { cn } from '../../src/lib/utils';

export type ChainOfThoughtStepStatus = 'pending' | 'active' | 'completed' | 'error';

const RootContext = React.createContext<{
  register(id: string, status: ChainOfThoughtStepStatus): void;
  complete: boolean;
  error: boolean;
} | null>(null);
const StepContext = React.createContext<{ status: ChainOfThoughtStepStatus } | null>(null);

export function ChainOfThought({
  children,
  className,
  autoCloseOnAllComplete = true,
}: React.ComponentProps<typeof CollapsiblePrimitive.Root> & {
  autoCloseOnAllComplete?: boolean;
}) {
  const [open, setOpen] = React.useState(true);
  const [statuses, setStatuses] = React.useState<Record<string, ChainOfThoughtStepStatus>>({});
  const values = Object.values(statuses);
  const complete = values.length > 0 && values.every((status) => status === 'completed');
  const error = values.some((status) => status === 'error');
  const register = React.useCallback((id: string, status: ChainOfThoughtStepStatus) => {
    setStatuses((current) => (current[id] === status ? current : { ...current, [id]: status }));
  }, []);
  useOnChange(complete, (current) => {
    if (current && autoCloseOnAllComplete) setOpen(false);
  });
  useOnChange(error, (current) => {
    if (current) setOpen(true);
  });
  return (
    <RootContext.Provider value={{ register, complete, error }}>
      <CollapsiblePrimitive.Root className={className} open={open} onOpenChange={setOpen}>
        {children}
      </CollapsiblePrimitive.Root>
    </RootContext.Provider>
  );
}

export function ChainOfThoughtTrigger({
  children,
  className,
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  const root = React.useContext(RootContext)!;
  return (
    <CollapsiblePrimitive.Trigger
      className={cn('chain-of-thought__trigger', className)}
      aria-label={root.error ? 'Nudge needs attention' : root.complete ? 'Task complete' : 'Nudge is working'}
    >
      <span>{children}</span>
      <HugeiconsIcon icon={ArrowDown01Icon} size={16} />
    </CollapsiblePrimitive.Trigger>
  );
}

export const ChainOfThoughtContent = CollapsiblePrimitive.Content;

export function ChainOfThoughtStep({
  status = 'pending',
  children,
}: React.PropsWithChildren<{ status?: ChainOfThoughtStepStatus }>) {
  const root = React.useContext(RootContext)!;
  const id = React.useId();
  React.useEffect(() => root.register(id, status), [id, root, status]);
  return (
    <StepContext.Provider value={{ status }}>
      <div className="chain-of-thought__step" data-status={status}>
        {children}
      </div>
    </StepContext.Provider>
  );
}

export function ChainOfThoughtStepTitle({ children }: React.PropsWithChildren) {
  const step = React.useContext(StepContext)!;
  return (
    <div className="chain-of-thought__title">
      {step.status === 'error' ? <HugeiconsIcon icon={Alert02Icon} size={16} /> : <span className="step-dot" />}
      <span>{children}</span>
    </div>
  );
}

export function ChainOfThoughtStepContent({ children }: React.PropsWithChildren) {
  return <div className="chain-of-thought__detail">{children}</div>;
}

export function ChainOfThoughtComplete({ label }: { label: React.ReactNode }) {
  return <div className="chain-of-thought__complete">{label}</div>;
}
