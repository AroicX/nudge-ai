import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { Brain, ChevronDown } from 'lucide-react';
import * as React from 'react';

import { useOnChange } from '../../src/lib/use-on-change';
import { cn } from '../../src/lib/utils';
import { TextShimmer } from './text-shimmer';

const ReasoningContext = React.createContext({ isStreaming: false });

// Adapted from Nexus UI Reasoning. Completion and elapsed time come from the
// controller, so remounting the panel cannot reset or invent a task's duration.
export function Reasoning({
  isStreaming = false,
  complete = false,
  children,
  className,
}: React.PropsWithChildren<{ isStreaming?: boolean; complete?: boolean; className?: string }>) {
  const [open, setOpen] = React.useState(!complete);
  useOnChange(complete, (current) => setOpen(!current));
  useOnChange(isStreaming, (current) => {
    if (current) setOpen(true);
  });
  return (
    <ReasoningContext.Provider value={{ isStreaming }}>
      <CollapsiblePrimitive.Root
        data-slot="reasoning"
        data-streaming={isStreaming}
        className={className}
        open={open}
        onOpenChange={setOpen}
      >
        {children}
      </CollapsiblePrimitive.Root>
    </ReasoningContext.Provider>
  );
}

export function ReasoningTrigger({
  children,
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  const { isStreaming } = React.useContext(ReasoningContext);
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="reasoning-trigger"
      className={cn('reasoning__trigger', className)}
      {...props}
    >
      <Brain size={16} aria-hidden="true" />
      <TextShimmer className="reasoning__label" invertLight disableShimmer={!isStreaming}>
        {children}
      </TextShimmer>
      <ChevronDown className="reasoning__chevron" size={16} aria-hidden="true" />
    </CollapsiblePrimitive.Trigger>
  );
}

export function ReasoningContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="reasoning-content"
      className={cn('reasoning__content', className)}
      {...props}
    />
  );
}
