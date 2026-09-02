-- Meetings rebuild, Phase 1 -- fix for a real gap found during RPC testing:
-- apply_meeting_ai_suggestion()'s conflict detection compares
-- target_snapshot.updated_at against the target row's CURRENT updated_at,
-- but neither vihem_work_orders nor vihem_customer_projects had a trigger
-- that actually bumps updated_at on write (confirmed by testing -- an
-- UPDATE to vihem_work_orders left updated_at unchanged, so a genuine
-- stale-overwrite scenario went undetected). Without this, the "atomic
-- conflict check on the server, not just the frontend" guarantee the plan
-- requires does not actually hold for these two tables. Adding the same
-- vihem_touch_updated_at trigger already used elsewhere in the schema --
-- purely additive, only changes updated_at to actually reflect the last
-- write, which every other vihem_-prefixed table already assumes.

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_work_orders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.vihem_work_orders
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.vihem_customer_projects;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.vihem_customer_projects
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

NOTIFY pgrst, 'reload schema';
