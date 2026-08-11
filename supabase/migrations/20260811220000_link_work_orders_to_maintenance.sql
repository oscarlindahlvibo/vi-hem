-- Keep a maintenance request and its generated work order(s) in one customer-facing flow.
CREATE OR REPLACE FUNCTION public.sync_maintenance_from_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  linked_total integer;
  linked_open integer;
  linked_completed integer;
  next_customer_status text;
BEGIN
  IF NEW.maintenance_request_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE status NOT IN ('completed', 'cancelled'))::integer,
    count(*) FILTER (WHERE status = 'completed')::integer
  INTO linked_total, linked_open, linked_completed
  FROM public.vihem_work_orders
  WHERE maintenance_request_id = NEW.maintenance_request_id;

  IF linked_open = 0 THEN
    next_customer_status := CASE WHEN linked_completed > 0 THEN 'done' ELSE 'closed' END;
  ELSE
    SELECT CASE
      WHEN bool_or(status = 'waiting_material') THEN 'waiting_material'
      WHEN bool_or(status = 'waiting_contractor') THEN 'waiting_contractor'
      WHEN bool_or(status IN ('started', 'paused', 'waiting_tenant', 'ready_for_check')) THEN 'started'
      WHEN bool_or(status IN ('assigned', 'new')) THEN 'assigned'
      ELSE 'received'
    END
    INTO next_customer_status
    FROM public.vihem_work_orders
    WHERE maintenance_request_id = NEW.maintenance_request_id
      AND status NOT IN ('completed', 'cancelled');
  END IF;

  UPDATE public.vihem_maintenance_requests
  SET status = next_customer_status,
      updated_at = now()
  WHERE id = NEW.maintenance_request_id
    AND status IS DISTINCT FROM next_customer_status;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_maintenance_from_work_order ON public.vihem_work_orders;
CREATE TRIGGER trg_sync_maintenance_from_work_order
AFTER INSERT OR UPDATE OF status, maintenance_request_id ON public.vihem_work_orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_maintenance_from_work_order();

CREATE OR REPLACE FUNCTION public.copy_public_work_order_comment_to_maintenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id uuid;
BEGIN
  IF NEW.internal THEN
    RETURN NEW;
  END IF;

  SELECT maintenance_request_id
  INTO request_id
  FROM public.vihem_work_orders
  WHERE id = NEW.work_order_id;

  IF request_id IS NOT NULL THEN
    INSERT INTO public.vihem_maintenance_request_comments (request_id, user_id, comment, internal)
    VALUES (request_id, NEW.user_id, NEW.comment, false);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_copy_public_work_order_comment_to_maintenance ON public.vihem_work_order_comments;
CREATE TRIGGER trg_copy_public_work_order_comment_to_maintenance
AFTER INSERT ON public.vihem_work_order_comments
FOR EACH ROW
EXECUTE FUNCTION public.copy_public_work_order_comment_to_maintenance();
