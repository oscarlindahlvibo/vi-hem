-- Same rationale as vihem_audit_access_entry_change
-- (20260901140000_access_entries.sql): a DB trigger can't be bypassed by
-- writing directly through the client instead of an edge function, unlike
-- an edge-function-only audit call. Covers "rutin skapad/ändrad/
-- publicerad/arkiverad", "rutin kvitterad" and "checklista slutförd" from
-- the spec's audit list without relying on every call site to remember.

CREATE OR REPLACE FUNCTION public.vihem_audit_routine_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
  v_actor uuid;
BEGIN
  v_actor := NEW.created_by;
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'routine_created';
  ELSIF OLD.status <> 'published' AND NEW.status = 'published' THEN
    v_event_type := 'routine_published';
  ELSIF OLD.status <> 'archived' AND NEW.status = 'archived' THEN
    v_event_type := 'routine_archived';
  ELSE
    v_event_type := 'routine_updated';
  END IF;

  INSERT INTO public.vihem_audit_events (organisation_id, actor_id, event_type, entity_type, entity_id, summary, metadata)
  VALUES (NEW.organisation_id, v_actor, v_event_type, 'routine', NEW.id, NEW.title, jsonb_build_object('status', NEW.status));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vihem_audit_routine_change ON public.vihem_routines;
CREATE TRIGGER trg_vihem_audit_routine_change
  AFTER INSERT OR UPDATE ON public.vihem_routines
  FOR EACH ROW EXECUTE FUNCTION public.vihem_audit_routine_change();

CREATE OR REPLACE FUNCTION public.vihem_audit_routine_acknowledged()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_title text;
BEGIN
  SELECT organisation_id, title INTO v_org, v_title FROM public.vihem_routines WHERE id = NEW.routine_id;
  INSERT INTO public.vihem_audit_events (organisation_id, actor_id, event_type, entity_type, entity_id, summary, metadata)
  VALUES (v_org, NEW.user_id, 'routine_acknowledged', 'routine', NEW.routine_id, v_title, jsonb_build_object('routine_version_id', NEW.routine_version_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vihem_audit_routine_acknowledged ON public.vihem_routine_acknowledgements;
CREATE TRIGGER trg_vihem_audit_routine_acknowledged
  AFTER INSERT ON public.vihem_routine_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.vihem_audit_routine_acknowledged();

CREATE OR REPLACE FUNCTION public.vihem_audit_checklist_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'completed' AND NEW.status = 'completed' THEN
    INSERT INTO public.vihem_audit_events (organisation_id, actor_id, event_type, entity_type, entity_id, summary, metadata)
    VALUES (NEW.organisation_id, NEW.created_by, 'checklist_completed', 'checklist_instance', NEW.id, NEW.title, jsonb_build_object('work_order_id', NEW.work_order_id));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vihem_audit_checklist_completed ON public.vihem_checklist_instances;
CREATE TRIGGER trg_vihem_audit_checklist_completed
  AFTER UPDATE ON public.vihem_checklist_instances
  FOR EACH ROW EXECUTE FUNCTION public.vihem_audit_checklist_completed();

NOTIFY pgrst, 'reload schema';
