import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Undo2, X } from 'lucide-react';

interface Toast { id: number; text: string; kind: 'info' | 'error' | 'success'; actionLabel?: string; onAction?: () => void }
interface ToastApi { show: (text: string, opts?: { kind?: Toast['kind']; actionLabel?: string; onAction?: () => void; ms?: number }) => number; dismiss: (id: number) => void }
const Ctx = createContext<ToastApi>({ show: () => 0, dismiss: () => {} });
export const useToasts = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]); const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback<ToastApi['show']>((text, opts = {}) => { const id = nextId.current++; setToasts((t) => [...t.slice(-3), { id, text, kind: opts.kind ?? 'info', actionLabel: opts.actionLabel, onAction: opts.onAction }]); window.setTimeout(() => dismiss(id), opts.ms ?? (opts.actionLabel ? 7000 : 4500)); return id; }, [dismiss]);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return <Ctx.Provider value={api}>{children}
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-3 lg:bottom-6 lg:items-start lg:pl-[19rem]" role="region" aria-live="polite" aria-label="Notiser">
      {toasts.map((t) => <div key={t.id} className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${t.kind === 'error' ? 'bg-red-600 text-white' : t.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'}`}>
        <span className="min-w-0 flex-1">{t.text}</span>
        {t.actionLabel && <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1 font-bold hover:bg-white/25" onClick={() => { t.onAction?.(); dismiss(t.id); }}><Undo2 className="h-3.5 w-3.5" />{t.actionLabel}</button>}
        <button type="button" aria-label="Stäng" onClick={() => dismiss(t.id)} className="rounded p-0.5 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
      </div>)}
    </div></Ctx.Provider>;
}
