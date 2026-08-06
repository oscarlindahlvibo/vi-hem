-- Korttidsuthyrning: alla utcheckningar ska ge en städorder 11-15 och gamla öppna städorder arkiveras efter 3 dagar.

ALTER TABLE public.vihem_work_orders
  ADD COLUMN IF NOT EXISTS scheduled_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_vihem_work_orders_scheduled_start
  ON public.vihem_work_orders(organisation_id, scheduled_start_at)
  WHERE scheduled_start_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.vihem_archive_stale_short_stay_cleaning_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  archived_count integer := 0;
BEGIN
  IF to_regclass('public.vihem_work_orders') IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.vihem_work_orders wo
  SET priority = 'urgent',
      updated_at = now()
  FROM public.vihem_short_stay_bookings booking
  WHERE booking.cleaning_work_order_id = wo.id
    AND booking.booking_type = 'booking'
    AND booking.cleaning_status NOT IN ('clean', 'not_needed')
    AND wo.status NOT IN ('completed', 'cancelled')
    AND wo.scheduled_end_at < now()
    AND wo.priority <> 'urgent';

  UPDATE public.vihem_work_orders wo
  SET status = 'cancelled',
      updated_at = now()
  FROM public.vihem_short_stay_bookings booking
  WHERE booking.cleaning_work_order_id = wo.id
    AND booking.booking_type = 'booking'
    AND booking.cleaning_status NOT IN ('clean', 'not_needed')
    AND booking.end_date < (CURRENT_DATE - 3)
    AND wo.status NOT IN ('completed', 'cancelled');

  GET DIAGNOSTICS archived_count = ROW_COUNT;

  RETURN archived_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_sync_short_stay_cleaning_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  unit_record record;
  checklist_items jsonb;
  work_order_title text;
  work_order_description text;
  scheduled_start timestamptz;
  scheduled_end timestamptz;
  order_priority text;
  archived_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.booking_type <> 'booking' THEN
    RETURN NEW;
  END IF;

  IF to_regclass('public.vihem_work_orders') IS NULL THEN
    RETURN NEW;
  END IF;

  archived_count := public.vihem_archive_stale_short_stay_cleaning_orders();

  SELECT
    unit.name AS unit_name,
    unit.property_id,
    unit.apartment_id,
    property.name AS property_name,
    apartment.apartment_number
  INTO unit_record
  FROM public.vihem_short_stay_units unit
  LEFT JOIN public.vihem_properties property ON property.id = unit.property_id
  LEFT JOIN public.vihem_apartments apartment ON apartment.id = unit.apartment_id
  WHERE unit.id = NEW.unit_id;

  scheduled_start := (NEW.end_date + time '11:00') AT TIME ZONE 'Europe/Stockholm';
  scheduled_end := (NEW.end_date + time '15:00') AT TIME ZONE 'Europe/Stockholm';
  order_priority := CASE WHEN scheduled_end < now() THEN 'urgent' ELSE 'normal' END;

  IF NEW.cleaning_status = 'clean' THEN
    IF NEW.cleaning_work_order_id IS NOT NULL THEN
      UPDATE public.vihem_work_orders
      SET status = 'completed',
          completed_at = COALESCE(completed_at, now()),
          scheduled_start_at = scheduled_start,
          scheduled_end_at = scheduled_end,
          due_date = NEW.end_date,
          updated_at = now()
      WHERE id = NEW.cleaning_work_order_id
        AND status NOT IN ('completed', 'cancelled');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.cleaning_status = 'not_needed' THEN
    IF NEW.cleaning_work_order_id IS NOT NULL THEN
      UPDATE public.vihem_work_orders
      SET status = 'cancelled',
          scheduled_start_at = scheduled_start,
          scheduled_end_at = scheduled_end,
          due_date = NEW.end_date,
          updated_at = now()
      WHERE id = NEW.cleaning_work_order_id
        AND status NOT IN ('completed', 'cancelled');
    END IF;
    RETURN NEW;
  END IF;

  work_order_title := 'Städ korttidsuthyrning: ' || COALESCE(unit_record.unit_name, NEW.title, 'Bokning');
  work_order_description := concat_ws(E'\n',
    'Automatiskt skapad från korttidsuthyrning.',
    'Gäst: ' || NULLIF(COALESCE(NEW.guest_name, ''), ''),
    'Antal gäster: ' || COALESCE(NEW.guest_count, 1)::text,
    'Städfönster: ' || NEW.end_date::text || ' 11:00-15:00',
    'Avresa: ' || NEW.end_date::text || COALESCE(' ' || COALESCE(NEW.departure_time, time '11:00')::text, ''),
    'Enhet: ' || COALESCE(unit_record.unit_name, ''),
    'Fastighet/lägenhet: ' || trim(concat_ws(' ', COALESCE(unit_record.property_name, ''), COALESCE(unit_record.apartment_number, ''))),
    NULLIF(COALESCE(NEW.notes, ''), '')
  );

  checklist_items := jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid()::text, 'text', 'Kontrollera lägenhet/rum efter utcheckning', 'done', false),
    jsonb_build_object('id', gen_random_uuid()::text, 'text', 'Städa kök och badrum', 'done', false),
    jsonb_build_object('id', gen_random_uuid()::text, 'text', 'Byt sängkläder och handdukar', 'done', false),
    jsonb_build_object('id', gen_random_uuid()::text, 'text', 'Kontrollera skador och saknade inventarier', 'done', false),
    jsonb_build_object('id', gen_random_uuid()::text, 'text', 'Fyll på förbrukningsmaterial', 'done', false)
  );

  IF NEW.cleaning_work_order_id IS NULL THEN
    INSERT INTO public.vihem_work_orders (
      organisation_id,
      title,
      description,
      category,
      tags,
      priority,
      status,
      property_id,
      apartment_id,
      created_by,
      due_date,
      scheduled_start_at,
      scheduled_end_at,
      checklist,
      materials,
      attachments,
      created_at,
      updated_at
    )
    VALUES (
      NEW.organisation_id,
      work_order_title,
      work_order_description,
      'cleaning',
      ARRAY['korttidsuthyrning', 'städ', 'utcheckning'],
      order_priority,
      'new',
      unit_record.property_id,
      unit_record.apartment_id,
      NEW.created_by,
      NEW.end_date,
      scheduled_start,
      scheduled_end,
      checklist_items,
      '[]'::jsonb,
      '[]'::jsonb,
      now(),
      now()
    )
    RETURNING id INTO NEW.cleaning_work_order_id;
  ELSE
    UPDATE public.vihem_work_orders
    SET title = work_order_title,
        description = work_order_description,
        property_id = unit_record.property_id,
        apartment_id = unit_record.apartment_id,
        priority = order_priority,
        due_date = NEW.end_date,
        scheduled_start_at = scheduled_start,
        scheduled_end_at = scheduled_end,
        updated_at = now()
    WHERE id = NEW.cleaning_work_order_id
      AND status NOT IN ('completed', 'cancelled');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vihem_short_stay_cleaning_work_order ON public.vihem_short_stay_bookings;
CREATE TRIGGER trg_vihem_short_stay_cleaning_work_order
BEFORE INSERT OR UPDATE OF unit_id, booking_type, title, start_date, end_date, guest_name, guest_count, notes, cleaning_status, departure_time
ON public.vihem_short_stay_bookings
FOR EACH ROW
EXECUTE FUNCTION public.vihem_sync_short_stay_cleaning_work_order();

UPDATE public.vihem_short_stay_bookings booking
SET cleaning_status = 'dirty',
    updated_at = now()
WHERE booking.booking_type = 'booking'
  AND booking.cleaning_status = 'not_needed'
  AND booking.end_date >= (CURRENT_DATE - 3);

UPDATE public.vihem_short_stay_bookings booking
SET updated_at = now()
WHERE booking.booking_type = 'booking'
  AND booking.cleaning_status NOT IN ('clean', 'not_needed')
  AND booking.end_date >= (CURRENT_DATE - 3);

SELECT public.vihem_archive_stale_short_stay_cleaning_orders();
