import clsx from 'clsx';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { ButtonHTMLAttributes, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useEffect } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'xs' | 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'xs' && 'h-7 px-2 text-xs',
        size === 'sm' && 'h-8 px-2.5 text-sm',
        size === 'md' && 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        variant === 'danger' && 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
        variant === 'success' && 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
        variant === 'warning' && 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  ),
);

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('rounded-lg border border-slate-200 bg-white shadow-sm', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="text-slate-400">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = 'slate' | 'green' | 'amber' | 'blue' | 'violet' | 'red' | 'teal' | 'orange' | 'sky';
const toneClass: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
};

export function Badge({ tone = 'slate', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', toneClass[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Field({ label, children, hint, error, required, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="ms-0.5 text-rose-600">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

const inputBase =
  'block rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500';

/** Full width unless the caller sets an explicit width class. */
const widthOf = (className?: string) => (className && /(^|\s)w-/.test(className) ? '' : 'w-full');

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) => (
  <input ref={ref} className={clsx(inputBase, 'h-9', widthOf(className), className)} {...rest} />
));

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...rest }, ref) => (
  <select ref={ref} className={clsx(inputBase, 'h-9 pe-8', widthOf(className), className)} {...rest}>
    {children}
  </select>
));

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...rest }, ref) => (
  <textarea ref={ref} className={clsx(inputBase, 'min-h-[72px]', widthOf(className), className)} {...rest} />
));

export function Checkbox({ checked, onChange, label, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2 text-sm text-slate-700', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'flex max-h-[92vh] w-full flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; badge?: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={clsx('flex gap-1 overflow-x-auto border-b border-slate-200', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === tab.id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
          )}
        >
          {tab.label}
          {tab.badge}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 shadow-sm">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={clsx('rounded px-2.5 py-1 text-xs font-medium', value === o.id ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-brand-700', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}

export function InfoRow({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <dt className="text-2xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-900">{value === null || value === undefined || value === '' ? <span className="text-slate-400">—</span> : value}</dd>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{icon}</div>}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-slate-900 sm:text-xl">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const th = 'px-3 py-2 text-start text-2xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap';
export const td = 'px-3 py-2 text-sm text-slate-700 align-top';

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="min-w-full divide-y divide-slate-200">{children}</table>
    </div>
  );
}
