-- Adds 'lunch' as its own entry_type, distinct from generic 'break', so a
-- lunch can be tracked (and reminded about) by when someone actually
-- clocked into it rather than only against their configured schedule.
-- Constraint kept its original pre-namespace-rename name (the table was
-- renamed time_entries -> vihem_time_entries in
-- 20260616093000_vihem_namespace_tables.sql, which doesn't rename
-- constraints).

ALTER TABLE public.vihem_time_entries DROP CONSTRAINT IF EXISTS time_entries_entry_type_check;
ALTER TABLE public.vihem_time_entries ADD CONSTRAINT time_entries_entry_type_check
  CHECK (entry_type IN ('work', 'break', 'lunch'));
