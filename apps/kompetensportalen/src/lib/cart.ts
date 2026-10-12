import { useEffect, useState } from "react";

export type CartLine = { key: string; product_id: string; slug: string; name: string; unit_price: number; vat_rate: number; quantity: number; session_id?: string | null; session_label?: string; max_quantity?: number };
const KEY = "kp-cart-v1";
let state: CartLine[] = read();
const listeners = new Set<() => void>();
function read(): CartLine[] { try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v.filter((l) => l?.product_id && l.quantity > 0) : []; } catch { return []; } }
const write = (next: CartLine[]) => { state = next; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* privat läge */ } listeners.forEach((l) => l()); };
export const lineKey = (l: { product_id: string; session_id?: string | null }) => `${l.product_id}:${l.session_id ?? ""}`;
export const cartActions = {
  add(line: Omit<CartLine, "key">) { const key = lineKey(line); const ex = state.find((l) => l.key === key); write(ex ? state.map((l) => (l.key === key ? { ...l, quantity: Math.min(l.quantity + line.quantity, 500) } : l)) : [...state, { ...line, key }]); },
  setQuantity(key: string, quantity: number) { write(state.map((l) => (l.key === key ? { ...l, quantity } : l)).filter((l) => l.quantity > 0)); },
  remove(key: string) { write(state.filter((l) => l.key !== key)); },
  clear() { write([]); },
};
export function useCart() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return { items: state, count: state.reduce((s, l) => s + l.quantity, 0) };
}
