import type { ClaudeStatus } from '@kae/shared';
import * as Dialog from '@radix-ui/react-dialog';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { X } from 'lucide-react';
import { STATUS } from '../lib/status';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-on-accent hover:bg-accent-strong font-semibold disabled:bg-surface-3 disabled:text-faint disabled:opacity-100',
  secondary: 'bg-surface-2 text-fg border border-line hover:border-line-strong hover:bg-surface-3',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-error text-white hover:brightness-110 font-semibold dark:text-[#1a0b0b]',
  'danger-soft': 'border border-error/35 text-error hover:bg-error-soft font-medium',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'lg'; loading?: boolean }
>(function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-md text-sm transition-[background,border,color,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'lg' ? 'h-12 px-5 text-[15px]' : 'h-10 px-4',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function IconButton({ label, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={cx(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export function StatusDot({ status, className }: { status: ClaudeStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block size-2 shrink-0 rounded-full',
        STATUS[status].dot,
        status === 'working' && 'animate-pulse-dot',
        className,
      )}
    />
  );
}

export function StatusBadge({ status, size = 'md' }: { status: ClaudeStatus; size?: 'sm' | 'md' }) {
  const m = STATUS[status];
  const Icon = m.icon;
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium transition-colors duration-200',
        size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
        m.soft,
        m.text,
      )}
    >
      <Icon className={cx(size === 'sm' ? 'size-3.5' : 'size-4', status === 'working' && 'animate-spin [animation-duration:2.4s]')} aria-hidden />
      {m.label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-shimmer rounded-md bg-surface-2', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-line-strong bg-surface-2 px-1.5 font-mono text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-50',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-3',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'inline-block size-5 rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex h-9 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium transition-colors duration-150',
            value === o.value ? 'bg-surface text-fg shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex animate-fade-in flex-col items-center px-6 py-16 text-center">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-line bg-surface text-muted">{icon}</div>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {children && <p className="mt-1.5 max-w-xs text-sm text-muted">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Dialog that is a bottom sheet on phones and a centered panel on larger screens. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          className={cx(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] animate-sheet flex-col rounded-t-xl border-t border-line-strong bg-elevated shadow-pop outline-none',
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[12vh] sm:w-full sm:-translate-x-1/2 sm:animate-pop sm:rounded-xl sm:border',
            wide ? 'sm:max-w-xl' : 'sm:max-w-md',
          )}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 px-5 pb-1 pt-4 sm:pt-5">
            <div>
              <Dialog.Title className="text-[17px] font-semibold text-fg">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Fermer" className="-mr-2 -mt-2">
                <X className="size-5" />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-3 sm:pb-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
