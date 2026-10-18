// Adapted from https://nexus-ui.dev/docs/components/feedback-bar.
import { cloneElement, isValidElement, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

export function FeedbackBar({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={className ? `nudge-feedback ${className}` : 'nudge-feedback'}>
      {children}
    </div>
  );
}

export function FeedbackBarContent({ children, className }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `nudge-feedback__content ${className}` : 'nudge-feedback__content'}>{children}</div>;
}

export function FeedbackBarPrompt({ children, className }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `nudge-feedback__prompt ${className}` : 'nudge-feedback__prompt'}>{children}</div>;
}

export function FeedbackBarLabel({ children, className }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={className ? `nudge-feedback__label ${className}` : 'nudge-feedback__label'}>{children}</span>;
}

export function FeedbackBarActions({ children, className }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `nudge-feedback__actions ${className}` : 'nudge-feedback__actions'}>{children}</div>;
}

export function FeedbackBarAction({
  asChild,
  children,
  className,
}: {
  asChild?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const classNames = className ? `nudge-feedback__action ${className}` : 'nudge-feedback__action';
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ className?: string }>;
    return cloneElement(child, { className: [child.props.className, classNames].filter(Boolean).join(' ') });
  }
  return <div className={classNames}>{children}</div>;
}

export function FeedbackBarClose({ children, className }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `nudge-feedback__close ${className}` : 'nudge-feedback__close'}>{children}</div>;
}
