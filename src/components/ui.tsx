import {Button, Input, Select, Textarea, Card, EmptyState} from './presentationControls';
export {Badge, Button, Input, Select, Textarea, StatusBadge, Card, EmptyState} from './presentationControls';
export type {StatusTone} from './presentationControls';
import React, { useEffect, useRef, useState, useId } from 'react';
import { DialogSurface } from './primitives/DialogSurface';
import { useScrollLock } from '../lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'fullscreen';
  footer?: React.ReactNode;
  toolbar?: React.ReactNode;
  mobileFullscreen?: boolean;
  disableTextSelection?: boolean;
}

export function Modal({ open, onClose, title, children, footer, toolbar, mobileFullscreen = false, disableTextSelection = false, size = 'md' }: ModalProps) {
  useScrollLock(open);
  if (!open) return null;
  return <DialogSurface title={title} onClose={onClose} size={size} mobileFullscreen={mobileFullscreen} disableTextSelection={disableTextSelection} footer={footer} toolbar={toolbar}>{children}</DialogSurface>;
}

/** Samma som Modal men med smalare standardbredd -- används för snabbåtgärder (datum, ansvarig, status). */
export const BottomSheet = Modal;

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
  compactMobile?: boolean;
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  onClick?: () => void;
}

export function StatCard({ label, value, icon, color = 'text-blue-600 bg-blue-50', onClick, compactMobile = false }: StatCardProps) {
  return (
    <Card className={`p-4 min-w-0 ${onClick ? 'cursor-pointer hover:shadow-md transition-all' : ''}`} onClick={onClick}>
      <div className={`flex gap-3 min-w-0 ${compactMobile ? 'flex-col items-start sm:flex-row sm:items-center' : 'items-center'}`}>
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
        aria-label={placeholder}
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
    <div className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {backButton && (
          <button onClick={backButton} aria-label="Tillbaka" className="rounded-full p-2 text-slate-600 transition-colors hover:bg-white hover:text-slate-950">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}
        {Icon && (
          <div className="hidden rounded-2xl bg-blue-50 p-2.5 text-vihem-blue sm:block">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-vihem-ink break-words">
            {Icon && <Icon className="h-5 w-5 text-vihem-blue sm:hidden" />}
            {title}
          </h1>
          {subtitle && <p className="mt-0.5 max-w-3xl text-sm leading-6 text-vihem-muted">{subtitle}</p>}
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
  const strip=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const container=strip.current;
    if(!container)return;
    const reveal=()=>{const selected=container.querySelector<HTMLButtonElement>('[aria-pressed="true"]');if(!selected)return;const box=container.getBoundingClientRect(),item=selected.getBoundingClientRect();if(item.left<box.left||item.right>box.right)container.scrollLeft+=item.left-box.left-(box.width-item.width)/2;};
    reveal();const observer=new ResizeObserver(reveal);observer.observe(container);return()=>observer.disconnect();
  },[active]);
  return (
    <div ref={strip} className={`flex min-w-0 gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 ${className}`}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={active === tab.key}
          onKeyDown={event=>{const index=tabs.findIndex(item=>item.key===active);const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index-1+tabs.length)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;if(next>=0){event.preventDefault();onChange(tabs[next].key);(event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();}}}
          onClick={() => onChange(tab.key)}
          className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active === tab.key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
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

export { Avatar } from './primitives/Avatar';

export function SegmentedControl<T extends string>({ options, value, onChange, className = '' }: {
  options: { value: T; label: string; icon?: React.ReactNode; tone?: 'default' | 'warning' }[]; value: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div role="group" className={`flex rounded-xl bg-slate-100 p-1 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          aria-pressed={value === o.value}
          type="button"
          onKeyDown={event=>{const index=options.findIndex(item=>item.value===value);const next=event.key==='ArrowRight'?(index+1)%options.length:event.key==='ArrowLeft'?(index-1+options.length)%options.length:event.key==='Home'?0:event.key==='End'?options.length-1:-1;if(next>=0){event.preventDefault();onChange(options[next].value);(event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();}}}
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
