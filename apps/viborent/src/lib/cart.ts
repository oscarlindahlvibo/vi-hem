import { useEffect, useState } from "react";

// Varukorgen ligger i localStorage och töms ALDRIG förrän betalningen är bekräftad (inte vid start av betalning).
export type CartLine = { key: string; productId: string; slug: string; name: string; image: string; quantity: number; startAt: string; endAt: string };
export type PendingBooking = { id: string; reference: string; token: string; createdAt: number; holdExpiresAt: string | null; checkoutDigest?: string };
type State = { items: CartLine[]; pending: PendingBooking | null };
const KEY = "viborent-cart-v2";
const empty: State = { items: [], pending: null };

function read(): State {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || "null");
    if (stored && Array.isArray(stored.items)) return { items: stored.items.filter((i: CartLine) => i.productId && i.startAt && i.endAt), pending: stored.pending || null };
  } catch { /* privat läge / trasig data */ }
  return empty;
}
let state = read();
const listeners = new Set<() => void>();
const write = (next: State) => { state = next; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignorera */ } listeners.forEach((l) => l()); };
if (typeof window !== "undefined") window.addEventListener("storage", (e) => { if (e.key === KEY) { state = read(); listeners.forEach((l) => l()); } });

export const lineKey = (l: Pick<CartLine, "productId" | "startAt" | "endAt">) => `${l.productId}:${l.startAt}:${l.endAt}`;

export const cartActions = {
  add(line: Omit<CartLine, "key">) {
    const key = lineKey(line);
    const existing = state.items.find((i) => i.key === key);
    write({ pending: null, items: existing ? state.items.map((i) => (i.key === key ? { ...i, quantity: i.quantity + line.quantity } : i)) : [...state.items, { ...line, key }] });
  },
  replace(key: string, line: Omit<CartLine, "key">) {
    const nextKey = lineKey(line);
    if (nextKey !== key && state.items.some(i => i.key === nextKey)) return false;
    if (!state.items.some(i => i.key === key)) return false;
    write({ pending: null, items: state.items.map(i => i.key === key ? { ...line, key: nextKey } : i) });
    return true;
  },
  setQuantity(key: string, quantity: number) {
    write({ pending: null, items: state.items.map((i) => (i.key === key ? { ...i, quantity } : i)).filter((i) => i.quantity > 0) });
  },
  remove(key: string) { write({ pending: null, items: state.items.filter((i) => i.key !== key) }); },
  setPending(pending: PendingBooking | null) { write({ ...state, pending }); },
  /** Anropas först när bokningen är betald. */
  clear() { write(empty); },
};

export function useCart() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return { ...state, count: state.items.reduce((sum, i) => sum + i.quantity, 0) };
}
