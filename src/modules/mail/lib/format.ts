const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const DAYS = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Listvy: idag → klockslag, senaste veckan → veckodag, i år → "12 okt", annars "12 okt 2024". */
export function listDate(ts: number, now = new Date()): string {
  if (!ts) return ''; const d = new Date(ts);
  if (sameDay(d, now)) return hhmm(d);
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 6 && diff > 0) return DAYS[d.getDay()];
  return d.getFullYear() === now.getFullYear() ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function fullDate(ts: number | string): string {
  const d = new Date(ts); if (isNaN(d.getTime())) return '';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${hhmm(d)}`;
}
export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} kB` : `${(n / 1048576).toFixed(1)} MB`);
export const initials = (name: string, email: string) => { const s = (name || email || '?').replace(/[<>"]/g, '').trim(); const parts = s.split(/[\s.@_-]+/).filter(Boolean); return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase(); };
const PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#4f46e5', '#0891b2', '#65a30d', '#c026d3', '#b45309'];
export function avatarColor(seed: string): string { let h = 0; for (const c of seed.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
export const displayName = (a: { name: string; email: string }) => a.name || a.email.split('@')[0];
export const nextMorning = (daysAhead = 1, hour = 8) => { const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(hour, 0, 0, 0); return d; };
export const nextMonday = (hour = 8) => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(hour, 0, 0, 0); return d; };
export const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
