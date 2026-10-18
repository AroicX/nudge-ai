import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { ReactElement } from 'react';

export function ConfirmDelete({
  children,
  title,
  description,
  onConfirm,
}: {
  children: ReactElement;
  title: string;
  description: string;
  onConfirm(): void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{children}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="confirm-overlay" />
        <AlertDialog.Content className="confirm-dialog">
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          <div>
            <AlertDialog.Cancel asChild>
              <button type="button" className="secondary">
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button type="button" className="danger" onClick={onConfirm}>
                Delete
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
