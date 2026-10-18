// Adapted from https://nexus-ui.dev/docs/components/suggestions.
import {
  createContext,
  useContext,
  useEffect,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

type SuggestionVariant = 'filled' | 'outline' | 'ghost';
const SuggestionContext = createContext<(value: string) => void>(() => undefined);
const PanelContext = createContext<(open: boolean) => void>(() => undefined);

export function Suggestions({
  onSelect,
  children,
  className,
}: {
  onSelect(value: string): void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `suggestions ${className}` : 'suggestions'}>
      <SuggestionContext.Provider value={onSelect}>{children}</SuggestionContext.Provider>
    </div>
  );
}

export function SuggestionList({
  children,
  orientation = 'horizontal',
  className,
}: {
  children: ReactNode;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return (
    <div className={`suggestion-list suggestion-list--${orientation}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}

export function Suggestion({
  children,
  value,
  variant = 'filled',
  highlight,
  onClick,
  className,
}: {
  children: string;
  value?: string;
  variant?: SuggestionVariant;
  highlight?: string | string[];
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
  className?: string;
}) {
  const onSelect = useContext(SuggestionContext);
  const selected = value ?? children;
  const marks = (Array.isArray(highlight) ? highlight : highlight ? [highlight] : []).filter(Boolean);
  return (
    <button
      type="button"
      className={`suggestion suggestion--${variant}${className ? ` ${className}` : ''}`}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onSelect(selected);
      }}
    >
      <Highlighted text={children} marks={marks} />
    </button>
  );
}

export function SuggestionPanel({
  open = true,
  onOpenChange,
  onClose,
  children,
  className,
}: {
  open?: boolean;
  onOpenChange?(open: boolean): void;
  onClose?(): void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange?.(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) onClose?.();
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={className ? `suggestion-panel ${className}` : 'suggestion-panel'} role="region" aria-label="Suggestions">
      <PanelContext.Provider value={(next) => onOpenChange?.(next)}>{children}</PanelContext.Provider>
    </div>
  );
}

export function SuggestionPanelHeader({ children, className }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `suggestion-panel__header ${className}` : 'suggestion-panel__header'}>{children}</div>;
}

export function SuggestionPanelTitle({ children, className }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `suggestion-panel__title ${className}` : 'suggestion-panel__title'}>{children}</div>;
}

export function SuggestionPanelClose({
  children,
  onClick,
  className,
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const setOpen = useContext(PanelContext);
  return (
    <button
      type="button"
      className={className ? `suggestion-panel__close ${className}` : 'suggestion-panel__close'}
      aria-label="Close suggestions"
      onClick={(event) => {
        setOpen(false);
        onClick?.(event);
      }}
    >
      {children ?? 'Close'}
    </button>
  );
}

export function SuggestionPanelContent({ children, className }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `suggestion-panel__content ${className}` : 'suggestion-panel__content'}>{children}</div>;
}

function Highlighted({ text, marks }: { text: string; marks: string[] }) {
  if (!marks.length) return text;
  const pattern = new RegExp(`(${marks.map(escapeRegExp).join('|')})`, 'ig');
  return text.split(pattern).map((part, index) =>
    marks.some((mark) => mark.toLocaleLowerCase() === part.toLocaleLowerCase()) ? (
      <mark key={`${part}:${index}`}>{part}</mark>
    ) : (
      <span key={`${part}:${index}`}>{part}</span>
    ),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
