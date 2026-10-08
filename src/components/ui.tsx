import React, { useEffect, useRef, useState } from 'react';
import { useScrollLock } from '../lib/utils';

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
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-55 active:translate-y-px';
  const variants = {
    primary: 'bg-vihem-blue text-white shadow-sm shadow-blue-600/25 hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-white text-slate-800 ring-1 ring-slate-200 shadow-sm hover:bg-slate-50 hover:ring-slate-300 focus:ring-slate-400',
    danger: 'bg-vihem-danger text-white shadow-sm shadow-red-600/20 hover:brightness-95 focus:ring-red-500',
    ghost: 'text-slate-600 hover:bg-white/80 hover:text-slate-950 focus:ring-slate-400',
    outline: 'border border-slate-300 bg-white/70 text-slate-800 shadow-sm hover:bg-white hover:border-slate-400 focus:ring-slate-400',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs min-h-8',
    md: 'px-4 py-2 text-sm min-h-10',
    lg: 'px-5 py-3 text-base min-h-12',
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
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

export function Input({ label, error, hint, className = '', id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-sm font-semibold text-slate-700">{label}</label>}
      <input
        id={inputId}
        className={`vihem-field vihem-focus w-full rounded-lg border px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors ${error ? 'border-red-400 bg-red-50' : ''} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className = '', id, ...props }: TextareaProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-sm font-semibold text-slate-700">{label}</label>}
      <textarea
        id={inputId}
        className={`vihem-field vihem-focus w-full resize-none rounded-lg border px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors ${error ? 'border-red-400 bg-red-50' : ''} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, hint, options, className = '', id, ...props }: SelectProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-sm font-semibold text-slate-700">{label}</label>}
      <select
        id={inputId}
        className={`vihem-field vihem-focus w-full rounded-lg border px-3 py-2.5 text-sm text-slate-900 transition-colors ${error ? 'border-red-400' : ''} ${className}`}
        {...props}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className = '', onClick }: CardProps) {
  return (
    <div
      className={`vihem-surface rounded-card ${onClick ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useScrollLock(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const sizes = { sm: 'lg:max-w-sm', md: 'lg:max-w-lg', lg: 'lg:max-w-2xl', xl: 'lg:max-w-4xl', xxl: 'lg:max-w-7xl' };
  // Mobil: bottom sheet som glider upp. Desktop: traditionell dialogruta.
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-6">
      <div className="absolute inset-0 animate-fade-in bg-vihem-ink/45 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[88dvh] w-full ${sizes[size]} animate-sheet-up flex-col rounded-t-sheet bg-white shadow-sheet lg:max-h-[90vh] lg:animate-fade-in lg:rounded-card lg:shadow-float`}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-200 lg:hidden" />
        <div className="flex items-center justify-between px-5 pb-3 pt-3 lg:border-b lg:border-slate-100 lg:px-6 lg:py-4">
          <h2 className="text-lg font-bold text-vihem-ink">{title}</h2>
          <button onClick={onClose} aria-label="Stäng" className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-1 [-webkit-overflow-scrolling:touch] lg:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Samma som Modal men med smalare standardbredd -- används för snabbåtgärder (datum, ansvarig, status). */
export const BottomSheet = Modal;

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

interface SpinnerProps {
  className?: string;
}

export function Spinner({ className = 'h-6 w-6 text-blue-600' }: SpinnerProps) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function LoadingPage() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner className="h-8 w-8 text-blue-600" />
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  onClick?: () => void;
}

export function StatCard({ label, value, icon, color = 'text-blue-600 bg-blue-50', onClick }: StatCardProps) {
  return (
    <Card className={`p-4 min-w-0 ${onClick ? 'cursor-pointer hover:shadow-md transition-all' : ''}`} onClick={onClick}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex-shrink-0 rounded-lg p-2.5 ring-1 ring-black/5 ${color}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xl sm:text-2xl font-bold text-slate-800 break-words leading-tight">{value}</p>
          <p className="text-xs text-slate-500 font-medium mt-1 leading-snug break-words">{label}</p>
        </div>
      </div>
    </Card>
  );
}

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Sök...', className = '' }: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="vihem-field vihem-focus w-full rounded-lg border py-2.5 pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400"
      />
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  backButton?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
}

export function PageHeader({ title, subtitle, action, backButton, icon: Icon }: PageHeaderProps) {
  return (
    <div className="mb-6 flex min-w-0 flex-col gap-4 border-b border-slate-200/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {backButton && (
          <button onClick={backButton} className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-white hover:text-slate-950">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}
        {Icon && (
          <div className="hidden rounded-xl bg-blue-600 p-2.5 text-white shadow-sm shadow-blue-600/20 sm:block">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-[-0.02em] text-slate-950 break-words sm:text-2xl">
            {Icon && <Icon className="h-5 w-5 text-blue-600 sm:hidden" />}
            {title}
          </h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="w-full sm:w-auto sm:flex-shrink-0">{action}</div>}
    </div>
  );
}

interface TabsProps {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className = '' }: TabsProps) {
  return (
    <div className={`flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 ${className}`}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold transition-colors ${active === tab.key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface RevealSecretProps {
  /** A short, non-secret hint shown while masked, e.g. "••32". */
  hint?: string;
  /** Fetches the plaintext secret on demand -- never called until the user asks. */
  onReveal: () => Promise<string>;
  /** Fire-and-forget audit call when the revealed value is copied. */
  onCopied?: () => void;
  /** How long the revealed value stays on screen before re-masking itself. */
  autoHideMs?: number;
}

/**
 * Masked-by-default secret display used throughout Drift & rutiner.
 * The plaintext value only ever lives in this component's own local state
 * (never in a parent's state, a store, or a log call) and is cleared by a
 * timer -- both when it expires and on unmount.
 */
export function RevealSecret({ hint, onReveal, onCopied, autoHideMs = 30000 }: RevealSecretProps) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }, []);

  async function handleReveal() {
    setError('');
    setLoading(true);
    try {
      const secret = await onReveal();
      setRevealed(secret);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setRevealed(null), autoHideMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta koden.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable -- best effort only */
    }
    onCopied?.();
  }

  if (revealed) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-slate-900 px-3 py-1.5 font-mono text-base font-black tracking-wider text-white">{revealed}</span>
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>{copied ? 'Kopierad!' : 'Kopiera'}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-base font-black tracking-wider text-slate-400">{hint || '••••'}</span>
      <Button type="button" size="sm" variant="secondary" loading={loading} onClick={handleReveal}>Visa kod</Button>
      {error && <span className="text-xs font-semibold text-red-600">{error}</span>}
    </div>
  );
}

export interface ChecklistItemData {
  id: string;
  label: string;
  required?: boolean;
  completed?: boolean;
  comment?: string;
}

interface ChecklistItemProps {
  item: ChecklistItemData;
  onToggle: (id: string, completed: boolean) => void;
  onCommentChange?: (id: string, comment: string) => void;
  disabled?: boolean;
}

export function ChecklistItem({ item, onToggle, onCommentChange, disabled }: ChecklistItemProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={Boolean(item.completed)}
          disabled={disabled}
          onChange={(event) => onToggle(item.id, event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-blue-600"
        />
        <span className={`min-w-0 flex-1 text-sm font-semibold ${item.completed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
          {item.label}
          {item.required && <span className="ml-1 text-red-500">*</span>}
        </span>
      </label>
      {onCommentChange && (
        <input
          type="text"
          value={item.comment || ''}
          onChange={(event) => onCommentChange(item.id, event.target.value)}
          placeholder="Kommentar (valfritt)"
          className="vihem-field vihem-focus w-full rounded-lg border px-3 py-2 text-xs text-slate-700"
        />
      )}
    </div>
  );
}

// ── Gemensamma byggstenar för det nya designsystemet ─────────────────────

export function Avatar({ name, size = 'md', className = '' }: { name?: string | null; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const initials = (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
  const dims = { xs: 'h-5 w-5 text-[9px]', sm: 'h-6 w-6 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' }[size];
  return <span title={name || ''} className={`inline-flex shrink-0 items-center justify-center rounded-full bg-vihem-navy/10 font-bold text-vihem-navy ${dims} ${className}`}>{initials}</span>;
}

export function SegmentedControl<T extends string>({ options, value, onChange, className = '' }: {
  options: { value: T; label: string; icon?: React.ReactNode; tone?: 'default' | 'warning' }[]; value: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div role="tablist" className={`flex rounded-xl bg-slate-100 p-1 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-all ${
            value === o.value ? (o.tone === 'warning' ? 'bg-amber-100 text-amber-800 shadow-sm' : 'bg-white text-vihem-blue shadow-sm') : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-slate-200/70 ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}

export function SkeletonList({ rows = 6, className = '' }: { rows?: number; className?: string }) {
  return <div className={`space-y-2.5 ${className}`}>{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-[88px] w-full rounded-card" />)}</div>;
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
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_TONES[tone]} ${className}`}>{children}</span>;
}
