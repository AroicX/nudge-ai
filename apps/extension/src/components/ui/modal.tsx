import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="confirm-overlay" />
        <Dialog.Content className="settings-dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className={description ? '' : 'sr-only'}>{description ?? title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
