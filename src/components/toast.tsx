import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Check, AlertTriangle, Info } from 'lucide-react';

interface ToastOptions {
  tone?: 'success' | 'error' | 'info';
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}
interface ToastItem extends ToastOptions { id: number; message: string }

const ToastContext = createContext<{ show: (message: string, options?: ToastOptions) => void }>({ show: () => {} });

export const useToast = () => useContext(ToastContext);

/** Diskreta bekräftelser efter åtgärder, med valfri åtgärdsknapp (t.ex. "Ångra"). Ligger ovanför flytande navigationen. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  const show = useCallback((message: string, options: ToastOptions = {}) => {
    const id = ++counter.current;
    setItems((cur) => [...cur.slice(-2), { id, message, ...options }]);
    window.setTimeout(() => dismiss(id), options.durationMs ?? (options.onAction ? 6000 : 3200));
  }, [dismiss]);
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+6.25rem)] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {items.map((t) => {
          const Icon = t.tone === 'error' ? AlertTriangle : t.tone === 'info' ? Info : Check;
          const tone = t.tone === 'error' ? 'bg-vihem-danger' : t.tone === 'info' ? 'bg-vihem-navy' : 'bg-vihem-success';
          return (
            <div key={t.id} role="status" className="pointer-events-auto flex max-w-md animate-toast-in items-center gap-3 rounded-2xl bg-vihem-ink px-4 py-3 text-sm font-semibold text-white shadow-float">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1">{t.message}</span>
              {t.onAction && (
                <button onClick={() => { t.onAction?.(); dismiss(t.id); }} className="shrink-0 rounded-lg px-2 py-1 text-sky-300 hover:bg-white/10">{t.actionLabel || 'Ångra'}</button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
