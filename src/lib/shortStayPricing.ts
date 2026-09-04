// Priskalender + längd-på-vistelse-rabatter för korttidsuthyrning.
// Rena, testbara funktioner (ingen Supabase-åtkomst här) -- samma stil som
// installmentPlans.ts. Datum är alltid 'YYYY-MM-DD'-strängar.
import type { ShortStayLosDiscount, ShortStayRate, ShortStaySeason } from '../types';

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nightsBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86400000));
}

/**
 * Which season a given date falls in, if any. Overlapping seasons are
 * resolved by `priority` (highest wins), then by the narrowest date range
 * (more specific season wins over a broader one at equal priority).
 */
export function findSeasonForDate(seasons: ShortStaySeason[], date: string): ShortStaySeason | null {
  const matches = seasons.filter(season => date >= season.start_date && date <= season.end_date);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aSpan = nightsBetween(a.start_date, a.end_date);
    const bSpan = nightsBetween(b.start_date, b.end_date);
    return aSpan - bSpan;
  })[0];
}

/** Base nightly price for a unit in a season, falling back to the unit's default (season_id null) rate. */
export function getBaseNightlyPrice(rates: ShortStayRate[], unitId: string, seasonId: string | null): number | null {
  if (seasonId) {
    const seasonRate = rates.find(rate => rate.unit_id === unitId && rate.season_id === seasonId);
    if (seasonRate) return Number(seasonRate.price_per_night);
  }
  const defaultRate = rates.find(rate => rate.unit_id === unitId && rate.season_id === null);
  return defaultRate ? Number(defaultRate.price_per_night) : null;
}

/**
 * Best-matching length-of-stay discount tier: prefers a tier scoped to the
 * given season, falls back to a unit-wide tier (season_id null). Picks the
 * highest min_nights that's still <= the actual stay length -- not
 * cumulative with lower tiers.
 */
export function getLosDiscountPercent(discounts: ShortStayLosDiscount[], unitId: string, seasonId: string | null, nights: number): number {
  const scoped = discounts.filter(row => row.unit_id === unitId && (row.season_id === seasonId || row.season_id === null) && row.min_nights <= nights);
  if (scoped.length === 0) return 0;
  // A season-specific tier at the same min_nights threshold wins over the
  // unit-wide fallback tier.
  const best = scoped.sort((a, b) => {
    if (b.min_nights !== a.min_nights) return b.min_nights - a.min_nights;
    return a.season_id === seasonId ? -1 : b.season_id === seasonId ? 1 : 0;
  })[0];
  return Number(best.discount_percent);
}

export interface StayPriceNight {
  date: string;
  seasonId: string | null;
  seasonName: string | null;
  basePrice: number;
}

export interface StayPriceResult {
  nights: number;
  perNight: StayPriceNight[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  total: number;
  missingPriceDates: string[];
}

/**
 * Full price for a stay: sums each night's season-specific base price,
 * then applies a single length-of-stay discount (determined by the
 * check-in date's season and the total number of nights) to the whole
 * stay. A stay crossing a season boundary is priced night-by-night for the
 * base amount, but the LOS discount tier is always the check-in season's --
 * splitting the discount itself across a boundary would be more "correct"
 * but adds real complexity for a case that barely happens in practice.
 */
export function calculateStayPrice(
  unitId: string,
  startDate: string,
  endDate: string,
  seasons: ShortStaySeason[],
  rates: ShortStayRate[],
  discounts: ShortStayLosDiscount[],
): StayPriceResult {
  const nights = nightsBetween(startDate, endDate);
  const perNight: StayPriceNight[] = [];
  const missingPriceDates: string[] = [];
  let subtotal = 0;
  for (let i = 0; i < nights; i++) {
    const date = addDays(startDate, i);
    const season = findSeasonForDate(seasons, date);
    const basePrice = getBaseNightlyPrice(rates, unitId, season?.id ?? null);
    if (basePrice === null) { missingPriceDates.push(date); continue; }
    perNight.push({ date, seasonId: season?.id ?? null, seasonName: season?.name ?? null, basePrice });
    subtotal += basePrice;
  }
  const checkInSeason = nights > 0 ? findSeasonForDate(seasons, startDate) : null;
  const discountPercent = nights > 0 ? getLosDiscountPercent(discounts, unitId, checkInSeason?.id ?? null, nights) : 0;
  const discountAmount = Math.round(subtotal * (discountPercent / 100) * 100) / 100;
  const total = Math.round((subtotal - discountAmount) * 100) / 100;
  return { nights, perNight, subtotal, discountPercent, discountAmount, total, missingPriceDates };
}

export interface Beds24CalendarRange {
  from: string;
  to: string;
  price1: number;
}

/**
 * Computes the effective nightly price for `days` days starting at
 * `startDate` and collapses consecutive equal-price days into from/to
 * ranges, matching Beds24's CalendarWrite shape -- keeps the push payload
 * small instead of one entry per day. Dates with no configured price are
 * skipped entirely (left untouched in Beds24) rather than pushing a 0.
 */
export function buildBeds24PriceRanges(
  unitId: string,
  startDate: string,
  days: number,
  seasons: ShortStaySeason[],
  rates: ShortStayRate[],
): Beds24CalendarRange[] {
  const ranges: Beds24CalendarRange[] = [];
  let current: Beds24CalendarRange | null = null;
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const season = findSeasonForDate(seasons, date);
    const price = getBaseNightlyPrice(rates, unitId, season?.id ?? null);
    if (price === null) { current = null; continue; }
    if (current && current.price1 === price && addDays(current.to, 1) === date) {
      current.to = date;
    } else {
      current = { from: date, to: date, price1: price };
      ranges.push(current);
    }
  }
  return ranges;
}
