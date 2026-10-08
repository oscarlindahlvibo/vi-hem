// Prisberäkning för korttid -- samma logik som src/lib/shortStayPricing.ts (en vistelse prissätts natt för natt
// efter säsong, därefter en längdrabatt för hela vistelsen). Hålls som en egen kopia eftersom edge-funktioner
// inte kan importera från frontend-koden.
export interface Season { id: string; start_date: string; end_date: string; priority: number }
export interface Rate { unit_id: string; season_id: string | null; price_per_night: number | string }
export interface LosDiscount { unit_id: string; season_id: string | null; min_nights: number; discount_percent: number | string }

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function nightsBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000));
}
function findSeason(seasons: Season[], date: string): Season | null {
  const matches = seasons.filter((s) => date >= s.start_date && date <= s.end_date);
  if (!matches.length) return null;
  return matches.sort((a, b) => b.priority - a.priority || nightsBetween(a.start_date, a.end_date) - nightsBetween(b.start_date, b.end_date))[0];
}
function baseNightly(rates: Rate[], unitId: string, seasonId: string | null): number | null {
  if (seasonId) {
    const r = rates.find((x) => x.unit_id === unitId && x.season_id === seasonId);
    if (r) return Number(r.price_per_night);
  }
  const d = rates.find((x) => x.unit_id === unitId && x.season_id === null);
  return d ? Number(d.price_per_night) : null;
}
function losPercent(discounts: LosDiscount[], unitId: string, seasonId: string | null, nights: number): number {
  const scoped = discounts.filter((d) => d.unit_id === unitId && (d.season_id === seasonId || d.season_id === null) && d.min_nights <= nights);
  if (!scoped.length) return 0;
  return Number(scoped.sort((a, b) => b.min_nights - a.min_nights || (a.season_id === seasonId ? -1 : b.season_id === seasonId ? 1 : 0))[0].discount_percent);
}
export interface StayPrice { nights: number; perNight: { date: string; price: number }[]; subtotal: number; losPercent: number; losAmount: number; total: number; missing: string[] }
export function calculateStayPrice(unitId: string, start: string, end: string, seasons: Season[], rates: Rate[], discounts: LosDiscount[]): StayPrice {
  const nights = nightsBetween(start, end);
  const perNight: { date: string; price: number }[] = [];
  const missing: string[] = [];
  let subtotal = 0;
  for (let i = 0; i < nights; i++) {
    const date = addDays(start, i);
    const price = baseNightly(rates, unitId, findSeason(seasons, date)?.id ?? null);
    if (price === null) { missing.push(date); continue; }
    perNight.push({ date, price });
    subtotal += price;
  }
  const checkInSeason = nights > 0 ? findSeason(seasons, start) : null;
  const pct = nights > 0 ? losPercent(discounts, unitId, checkInSeason?.id ?? null, nights) : 0;
  const losAmount = Math.round(subtotal * (pct / 100) * 100) / 100;
  return { nights, perNight, subtotal, losPercent: pct, losAmount, total: Math.round((subtotal - losAmount) * 100) / 100, missing };
}
