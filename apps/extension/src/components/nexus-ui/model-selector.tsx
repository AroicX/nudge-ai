// Adapted to Nudge's CSS from https://nexus-ui.dev/docs/components/model-selector.
// The Radix primitives retain Nexus's radio selection, focus and keyboard behavior.
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';

interface ModelItem {
  value: string;
  title: string;
  description?: string;
}
const SelectionContext = createContext<{ value: string; items: ModelItem[] }>({
  value: '',
  items: [],
});

export function ModelSelector({
  value,
  items,
  children,
}: {
  value: string;
  items: ModelItem[];
  children: ReactNode;
}) {
  return (
    <SelectionContext.Provider value={{ value, items }}>
      <DropdownMenu.Root>{children}</DropdownMenu.Root>
    </SelectionContext.Provider>
  );
}
export function ModelSelectorTrigger(props: ComponentProps<typeof DropdownMenu.Trigger>) {
  const { value, items } = useContext(SelectionContext);
  return (
    <DropdownMenu.Trigger className="model-selector__trigger" {...props}>
      <span>{items.find((item) => item.value === value)?.title ?? value}</span>
      <ChevronDown size={14} />
    </DropdownMenu.Trigger>
  );
}
export function ModelSelectorContent({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        className="model-selector__content"
        side="top"
        align="start"
        sideOffset={8}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}
export const ModelSelectorGroup = DropdownMenu.Group;
export const ModelSelectorRadioGroup = DropdownMenu.RadioGroup;
export function ModelSelectorLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="model-selector__label">{children}</DropdownMenu.Label>;
}
export function ModelSelectorRadioItem({
  title,
  description,
  ...props
}: ModelItem & { disabled?: boolean }) {
  return (
    <DropdownMenu.RadioItem className="model-selector__item" {...props}>
      <span>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <DropdownMenu.ItemIndicator>
        <Check size={16} />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}
export function ModelSelectorAction(props: ComponentProps<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item className="model-selector__item" {...props} />;
}
