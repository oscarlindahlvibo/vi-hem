/*
  # Arbetsorder: historik (status-, datum-, prioritets- och tilldelningsändringar)

  Loggar ändringar i vihem_audit_events (entity_type = 'work_order') via en trigger,
  så att detaljvyn kan visa en Historik-sektion. Rent additivt: ingen befintlig tabell,
  kolumn eller policy ändras. Läsning begränsas till personal i samma organisation;
  hyresgäster ser aldrig historiken. Triggern skriver bara -- den kan inte blockera
  en uppdatering av arbetsordern.
*/

CREATE OR REPLACE FUNCTION public.vihem_log_work_order_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.vihem_audit_events (organisation_id, actor_id, event_type, entity_type, entity_id, summary, metadata)
      VALUES (NEW.organisation_id, v_actor, 'work_order_status_changed', 'work_order', NEW.id, '', jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
    IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
      INSERT INTO public.vihem_audit_events (organisation_id, actor_id, event_type, entity_type, entity_id, summary, metadata)
      VALUES (NEW.organisation_id, v_actor, 'work_order_due_date_changed', 'work_order', NEW.id, '', jsonb_build_object('from', OLD.due_date, 'to', NEW.due_date));
    END IF;
    IF NEW.priority IS DISTINCT FROM OLD.priority THEN
      INSERT INTO public.vihem_audit_events (organisation_id, actor_id, event_type, entity_type, entity_id, summary, metadata)
      VALUES (NEW.organisation_id, v_actor, 'work_order_priority_changed', 'work_order', NEW.id, '', jsonb_build_object('from', OLD.priority, 'to', NEW.priority));
    END IF;
    IF NEW.assigned_to_ids IS DISTINCT FROM OLD.assigned_to_ids OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      INSERT INTO public.vihem_audit_events (organisation_id, actor_id, event_type, entity_type, entity_id, summary, metadata)
      VALUES (NEW.organisation_id, v_actor, 'work_order_assignment_changed', 'work_order', NEW.id, '',
        jsonb_build_object('from', to_jsonb(COALESCE(OLD.assigned_to_ids, ARRAY[]::uuid[])), 'to', to_jsonb(COALESCE(NEW.assigned_to_ids, ARRAY[]::uuid[]))));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- historik får aldrig stoppa själva uppdateringen
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_work_order_changes ON public.vihem_work_orders;
CREATE TRIGGER trg_log_work_order_changes
AFTER UPDATE OF status, due_date, priority, assigned_to, assigned_to_ids ON public.vihem_work_orders
FOR EACH ROW EXECUTE FUNCTION public.vihem_log_work_order_changes();

DROP POLICY IF EXISTS "Staff read work order history" ON public.vihem_audit_events;
CREATE POLICY "Staff read work order history" ON public.vihem_audit_events FOR SELECT TO authenticated
  USING (
    entity_type = 'work_order'
    AND organisation_id = public.vihem_get_my_org_id()
    AND public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin')
  );
