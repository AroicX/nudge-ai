// Adapted to Nudge's CSS from https://nexus-ui.dev/docs/components/toaster.
import { AlertTriangle, Check, Info, LoaderCircle, OctagonX, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Toaster as Sonner, toast as sonnerToast, type ExternalToast, type ToasterProps } from 'sonner';
import 'sonner/dist/styles.css';

type ToastVariant = 'default' | 'success' | 'info' | 'warning' | 'error' | 'loading';
type ToastAction = { label: ReactNode; onClick?: () => void };
type ToastContent = {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  icon?: ReactNode | null;
  action?: ToastAction;
  cancel?: ToastAction;
} & Omit<ExternalToast, 'icon' | 'classNames' | 'unstyled' | 'action' | 'cancel'>;

const variantIcon: Partial<Record<ToastVariant, ReactNode>> = {
  success: <Check size={18} />,
  info: <Info size={18} />,
  warning: <AlertTriangle size={18} />,
  error: <OctagonX size={18} />,
  loading: <LoaderCircle size={18} className="toast-spin" />,
};

const toast = {
  custom(content: ToastContent) {
    const { title, description, variant, icon, action, cancel, dismissible, closeButton, ...options } =
      content;
    return sonnerToast.custom(
      (id) => (
        <ToastCard
          id={id}
          title={title}
          {...(description === undefined ? {} : { description })}
          {...(variant === undefined ? {} : { variant })}
          {...(icon === undefined ? {} : { icon })}
          {...(action === undefined ? {} : { action })}
          {...(cancel === undefined ? {} : { cancel })}
          {...(dismissible === undefined ? {} : { dismissible })}
          {...(closeButton === undefined ? {} : { closeButton })}
        />
      ),
      {
        ...options,
        ...(dismissible === undefined ? {} : { dismissible }),
        ...(closeButton === undefined ? {} : { closeButton }),
      },
    );
  },
  default(title: ReactNode, options?: Omit<ToastContent, 'title' | 'variant'>) {
    return toast.custom({ title, variant: 'default', ...options });
  },
  success(title: ReactNode, options?: Omit<ToastContent, 'title' | 'variant'>) {
    return toast.custom({ title, variant: 'success', ...options });
  },
  info(title: ReactNode, options?: Omit<ToastContent, 'title' | 'variant'>) {
    return toast.custom({ title, variant: 'info', ...options });
  },
  warning(title: ReactNode, options?: Omit<ToastContent, 'title' | 'variant'>) {
    return toast.custom({ title, variant: 'warning', ...options });
  },
  error(title: ReactNode, options?: Omit<ToastContent, 'title' | 'variant'>) {
    return toast.custom({ title, variant: 'error', ...options });
  },
  loading(title: ReactNode, options?: Omit<ToastContent, 'title' | 'variant'>) {
    return toast.custom({ title, variant: 'loading', ...options });
  },
  dismiss: sonnerToast.dismiss,
};

function ToastCard({
  id,
  title,
  description,
  icon,
  action,
  cancel,
  dismissible = true,
  closeButton = true,
  variant = 'default',
}: {
  id: string | number;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode | null;
  action?: ToastAction;
  cancel?: ToastAction;
  dismissible?: boolean;
  closeButton?: boolean;
  variant?: ToastVariant;
}) {
  const resolved = icon === null ? null : (icon ?? variantIcon[variant]);
  return (
    <div className="nudge-toast" data-variant={variant}>
      {resolved ? <span className="nudge-toast__icon">{resolved}</span> : null}
      <div>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
        {action || cancel ? (
          <div className="nudge-toast__actions">
            {action ? (
              <button
                type="button"
                onClick={() => {
                  action.onClick?.();
                  if (dismissible !== false) sonnerToast.dismiss(id);
                }}
              >
                {action.label}
              </button>
            ) : null}
            {cancel ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  cancel.onClick?.();
                  if (dismissible !== false) sonnerToast.dismiss(id);
                }}
              >
                {cancel.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {dismissible !== false && closeButton !== false ? (
        <button type="button" className="nudge-toast__close" aria-label="Close notification" onClick={() => sonnerToast.dismiss(id)}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

function Toaster({ theme = 'light', ...props }: ToasterProps) {
  return <Sonner theme={theme} className="nudge-toaster" toastOptions={{ unstyled: true }} {...props} />;
}

export { toast, Toaster };
