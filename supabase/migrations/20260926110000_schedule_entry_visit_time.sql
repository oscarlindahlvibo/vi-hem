-- Optional clock time for a schedule entry (vihem_schedule_entries) --
-- e.g. "besök hos kund kl 14:00" on a day that's otherwise scheduled at
-- day granularity only. Deliberately a single point in time, not a
-- start/end range: the board stays day-level by default, this is just an
-- optional detail shown alongside the day block when it matters.
ALTER TABLE public.vihem_schedule_entries ADD COLUMN IF NOT EXISTS visit_time time;

NOTIFY pgrst, 'reload schema';
