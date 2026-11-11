import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

/** Finestra modal comuna. */
export function Modal({
  title,
  subtitle,
  icon,
  onClose,
  busy,
  footer,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink-900/40 p-0 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx('flex max-h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:rounded-2xl', wide ? 'max-w-4xl' : 'max-w-xl')}
      >
        <header className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
          {icon ? <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span> : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
            {subtitle ? <p className="text-sm text-ink-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40"
            aria-label="Tanca"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 bg-ink-50 px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-ink-800">
        {label}
        {hint ? <span className="ml-1 font-normal text-ink-500">{hint}</span> : null}
      </p>
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  tone = 'brand',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'brand' | 'amber' | 'emerald' | 'danger';
  type?: 'button' | 'submit';
}) {
  const tones = {
    brand: 'bg-brand-500 hover:bg-brand-600',
    amber: 'bg-amber-500 hover:bg-amber-600',
    emerald: 'bg-emerald-600 hover:bg-emerald-700',
    danger: 'bg-danger hover:brightness-95',
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tones[tone],
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">{message}</p>;
}
