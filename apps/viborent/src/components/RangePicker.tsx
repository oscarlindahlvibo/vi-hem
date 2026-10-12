import { useMemo, useState } from "react";
import type { CalendarData } from "../api";
import { addDays, isoToLocalParts, todayLocal, zonedToIso } from "../lib/time";

export type Range = { startDate: string; endDate: string; startHour: number; endHour: number };

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const WEEKDAYS = ["mån", "tis", "ons", "tor", "fre", "lör", "sön"];

/** Antal lediga objekt vid en tidpunkt, med buffert runt varje bokning och produktövergripande blockeringar. */
export function freeAt(cal: CalendarData, t: number): number {
  const buf = (cal.buffer_minutes || 0) * 60000;
  for (const [s, e] of cal.blocked) if (t >= Date.parse(s) && t < Date.parse(e)) return 0;
  let busy = 0;
  for (const asset of cal.assets) if (asset.busy.some(([s, e]) => t >= Date.parse(s) - buf && t < Date.parse(e) + buf)) busy++;
  return Math.max(0, cal.capacity - busy);
}

export function rangeIsFree(cal: CalendarData, startIso: string, endIso: string, quantity: number) {
  for (let t = Date.parse(startIso); t < Date.parse(endIso); t += 3600_000) if (freeAt(cal, t) < quantity) return false;
  return true;
}

export function RangePicker({ calendar, timeZone, quantity, value, onChange, minAdvanceHours = 0, maxAdvanceDays = 730, onMonthChange }: {
  calendar: CalendarData | null; timeZone: string; quantity: number; value: Range | null; onChange: (value: Range | null) => void;
  minAdvanceHours?: number; maxAdvanceDays?: number; onMonthChange?: (monthStart: string) => void;
}) {
  const today = todayLocal(timeZone);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [pickingEnd, setPickingEnd] = useState(false);
  const [startHour, setStartHour] = useState(value?.startHour ?? 9);
  const [endHour, setEndHour] = useState(value?.endHour ?? 17);
  const earliest = useMemo(() => isoToLocalParts(new Date(Date.now() + minAdvanceHours * 3600_000).toISOString(), timeZone).date, [minAdvanceHours, timeZone]);
  const latest = addDays(today, maxAdvanceDays);

  const dayState = (date: string): "free" | "partial" | "full" | "past" => {
    if (date < earliest && date < today) return "past";
    if (date < today || date > latest) return "past";
    if (!calendar) return "free";
    let free = 0;
    for (let h = 0; h < 24; h++) if (freeAt(calendar, Date.parse(zonedToIso(date, h, timeZone))) >= quantity) free++;
    return free === 24 ? "free" : free === 0 ? "full" : "partial";
  };

  const [year, mon] = month.split("-").map(Number);
  const first = `${month}-01`;
  const firstDow = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const goMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, mon - 1 + delta, 1)); const next = d.toISOString().slice(0, 7);
    setMonth(next); onMonthChange?.(`${next}-01`);
  };

  const emit = (startDate: string, endDate: string, sh = startHour, eh = endHour) => onChange({ startDate, endDate, startHour: sh, endHour: eh });
  const pick = (date: string) => {
    if (!value || !pickingEnd || date < value.startDate) { emit(date, date); setPickingEnd(true); return; }
    emit(value.startDate, date); setPickingEnd(false);
  };
  const inRange = (date: string) => value && date >= value.startDate && date <= value.endDate;
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="range-picker">
      <div className="cal-head">
        <button type="button" onClick={() => goMonth(-1)} aria-label="Föregående månad" disabled={month <= today.slice(0, 7)}>‹</button>
        <strong>{MONTHS[mon - 1]} {year}</strong>
        <button type="button" onClick={() => goMonth(1)} aria-label="Nästa månad">›</button>
      </div>
      <div className="cal-grid" role="grid" aria-label="Välj datum">
        {WEEKDAYS.map((d) => <span key={d} className="dow" role="columnheader">{d}</span>)}
        {cells.map((date, i) => {
          if (!date) return <span key={`e${i}`} />;
          const state = dayState(date);
          const disabled = state === "past" || state === "full";
          return (
            <button
              key={date} type="button" role="gridcell" disabled={disabled}
              aria-pressed={!!inRange(date)} aria-label={`${date}${state === "full" ? ", upptaget" : state === "partial" ? ", delvis ledigt" : ""}`}
              className={`day ${state} ${inRange(date) ? "selected" : ""} ${value?.startDate === date ? "edge-start" : ""} ${value?.endDate === date ? "edge-end" : ""}`}
              onClick={() => pick(date)}
            >{Number(date.slice(8))}</button>
          );
        })}
      </div>
      <div className="legend"><span><i className="dot free" /> Ledigt</span><span><i className="dot partial" /> Delvis</span><span><i className="dot full" /> Upptaget</span></div>
      <p className="hint">{!value ? "Välj startdag." : pickingEnd ? "Välj slutdag (eller samma dag)." : "Justera tider nedan eller välj nya dagar."}</p>
      <div className="time-row">
        <label>Hämtas
          <select value={startHour} onChange={(e) => { const h = Number(e.target.value); setStartHour(h); if (value) emit(value.startDate, value.endDate, h, endHour); }}>
            {hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </label>
        <label>Lämnas
          <select value={endHour} onChange={(e) => { const h = Number(e.target.value); setEndHour(h); if (value) emit(value.startDate, value.endDate, startHour, h); }}>
            {hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </label>
        {value && <button type="button" className="text-link" onClick={() => { onChange(null); setPickingEnd(false); }}>Rensa</button>}
      </div>
    </div>
  );
}
