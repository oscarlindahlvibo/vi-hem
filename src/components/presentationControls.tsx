// Pure shared app controls: no authentication, network or storage dependencies.
import React, {useId} from 'react';
interface BadgeProps {
  children?: React.ReactNode;
  className?: string;
  text?: string;
}

export function Badge({ children, className = '', text }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {children ?? text}
    </span>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({ children, variant = 'primary', size = 'md', loading, className = '', disabled, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:brightness-95';
  const variants = {
    primary: 'bg-vihem-blue text-white  hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300 focus:ring-slate-400',
    danger: 'bg-vihem-danger text-white  hover:brightness-95 focus:ring-red-500',
    ghost: 'text-slate-600 hover:bg-white/80 hover:text-slate-950 focus:ring-slate-400',
    outline: 'border border-slate-300 bg-white/70 text-slate-800 shadow-sm hover:bg-white hover:border-slate-400 focus:ring-slate-400',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-sm min-h-8 vihem-touch-target',
    md: 'px-4 py-2 text-sm min-h-10 vihem-touch-target',
    lg: 'px-5 py-3 text-base min-h-12',
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className = '', id, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-sm font-medium text-slate-700">{label}</label>}
      <input
        id={inputId}
        aria-invalid={error ? true : invalid}
        aria-describedby={[describedBy, error || hint ? descriptionId : ''].filter(Boolean).join(' ') || undefined}
        className={`vihem-field vihem-focus w-full rounded-lg border px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors ${error ? 'border-red-400 bg-red-50' : ''} ${className}`}
        {...props}
      />
      {error && <p id={descriptionId} role="alert" className="text-sm text-red-700">{error}</p>}
      {hint && !error && <p id={descriptionId} className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className = '', id, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }: TextareaProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-sm font-medium text-slate-700">{label}</label>}
      <textarea
        id={inputId}
        aria-invalid={error ? true : invalid}
        aria-describedby={[describedBy, error ? descriptionId : ''].filter(Boolean).join(' ') || undefined}
        className={`vihem-field vihem-focus w-full resize-none rounded-lg border px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors ${error ? 'border-red-400 bg-red-50' : ''} ${className}`}
        {...props}
      />
      {error && <p id={descriptionId} role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, hint, options, className = '', id, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }: SelectProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-sm font-medium text-slate-700">{label}</label>}
      <select
        id={inputId}
        aria-invalid={error ? true : invalid}
        aria-describedby={[describedBy, error || hint ? descriptionId : ''].filter(Boolean).join(' ') || undefined}
        className={`vihem-field vihem-focus w-full rounded-lg border px-3 py-2.5 text-sm text-slate-900 transition-colors ${error ? 'border-red-400' : ''} ${className}`}
        {...props}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p id={descriptionId} role="alert" className="text-sm text-red-700">{error}</p>}
      {hint && !error && <p id={descriptionId} className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export type StatusTone = 'danger' | 'success' | 'info' | 'warning' | 'neutral' | 'priority';
const STATUS_TONES: Record<StatusTone, string> = {
  danger: 'bg-red-50 text-red-700',
  success: 'bg-emerald-50 text-emerald-700',
  info: 'bg-blue-50 text-blue-700',
  warning: 'bg-amber-50 text-amber-800',
  neutral: 'bg-slate-100 text-slate-600',
  priority: 'bg-orange-50 text-orange-700',
};
export function StatusBadge({ tone = 'neutral', children, className = '' }: { tone?: StatusTone; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONES[tone]} ${className}`}>{children}</span>;
}

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className = '', onClick }: CardProps) {
  return (
    <div
      className={`vihem-surface rounded-card ${onClick ? 'cursor-pointer transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(); } } : undefined}
    >
      {children}
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode | React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const isIconElement = React.isValidElement(icon);
  const isIconComponent = typeof icon === 'function'
    || (typeof icon === 'object' && icon !== null && '$$typeof' in icon && !isIconElement);
  const iconNode = isIconElement
    ? icon
    : isIconComponent
      ? React.createElement(icon as React.ElementType, { className: 'w-12 h-12' })
      : icon as React.ReactNode;
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      {icon && (
        <div className="mb-4 rounded-xl bg-blue-50 p-3 text-blue-500 ring-1 ring-blue-100">
          {iconNode}
        </div>
      )}
      <h3 className="text-base font-bold text-slate-800">{title}</h3>
      {description && <p className="mt-1 text-sm text-slate-400 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
