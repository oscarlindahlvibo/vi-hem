-- Rensa gamla städorder när en ny korttidsincheckning har skett i samma enhet.

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

  IF NEW.cleaning_status IN ('clean', 'not_needed') THEN
    IF NEW.cleaning_work_order_id IS NOT NULL THEN
      UPDATE public.vihem_work_orders
      SET status = CASE WHEN NEW.cleaning_status = 'clean' THEN 'completed' ELSE 'cancelled' END,
          completed_at = CASE WHEN NEW.cleaning_status = 'clean' THEN COALESCE(completed_at, now()) ELSE completed_at END,
          updated_at = now()
      WHERE id = NEW.cleaning_work_order_id
        AND status NOT IN ('completed', 'cancelled');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.start_date <= CURRENT_DATE THEN
    UPDATE public.vihem_work_orders wo
    SET status = 'cancelled',
        updated_at = now()
    FROM public.vihem_short_stay_bookings old_booking
    WHERE old_booking.cleaning_work_order_id = wo.id
      AND old_booking.organisation_id = NEW.organisation_id
      AND old_booking.unit_id = NEW.unit_id
      AND old_booking.id <> COALESCE(NEW.id, old_booking.id)
      AND old_booking.booking_type = 'booking'
      AND old_booking.end_date < NEW.start_date
      AND old_booking.cleaning_status NOT IN ('clean', 'not_needed')
      AND wo.status NOT IN ('completed', 'cancelled');

    UPDATE public.vihem_short_stay_bookings old_booking
    SET cleaning_status = 'not_needed',
        updated_at = now()
    WHERE old_booking.organisation_id = NEW.organisation_id
      AND old_booking.unit_id = NEW.unit_id
      AND old_booking.id <> COALESCE(NEW.id, old_booking.id)
      AND old_booking.booking_type = 'booking'
      AND old_booking.end_date < NEW.start_date
      AND old_booking.cleaning_status NOT IN ('clean', 'not_needed');
  END IF;

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

  work_order_title := 'Städ korttidsuthyrning: ' || COALESCE(unit_record.unit_name, NEW.title, 'Bokning');
  work_order_description := concat_ws(E'\n',
    'Automatiskt skapad från korttidsuthyrning.',
    'Gäst: ' || NULLIF(COALESCE(NEW.guest_name, ''), ''),
    'Antal gäster: ' || COALESCE(NEW.guest_count, 1)::text,
    'Avresa: ' || NEW.end_date::text || COALESCE(' ' || NEW.departure_time::text, ''),
    'Enhet: ' || COALESCE(unit_record.unit_name, ''),
    'Fastighet/lägenhet: ' || trim(concat_ws(' ', COALESCE(unit_record.property_name, ''), COALESCE(unit_record.apartment_number, ''))),
    NULLIF(COALESCE(NEW.notes, ''), '')
  );

  checklist_items := jsonb_build_array(
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
      ARRAY['korttidsuthyrning', 'städ'],
      'normal',
      'new',
      unit_record.property_id,
      unit_record.apartment_id,
      NEW.created_by,
      NEW.end_date,
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
        due_date = NEW.end_date,
        updated_at = now()
    WHERE id = NEW.cleaning_work_order_id
      AND status NOT IN ('completed', 'cancelled');
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.vihem_work_orders wo
SET status = 'cancelled',
    updated_at = now()
FROM public.vihem_short_stay_bookings stale_booking
WHERE stale_booking.cleaning_work_order_id = wo.id
  AND stale_booking.booking_type = 'booking'
  AND stale_booking.cleaning_status NOT IN ('clean', 'not_needed')
  AND wo.status NOT IN ('completed', 'cancelled')
  AND EXISTS (
    SELECT 1
    FROM public.vihem_short_stay_bookings newer_booking
    WHERE newer_booking.organisation_id = stale_booking.organisation_id
      AND newer_booking.unit_id = stale_booking.unit_id
      AND newer_booking.booking_type = 'booking'
      AND newer_booking.start_date <= CURRENT_DATE
      AND newer_booking.start_date > stale_booking.end_date
  );

UPDATE public.vihem_short_stay_bookings stale_booking
SET cleaning_status = 'not_needed',
    updated_at = now()
WHERE stale_booking.booking_type = 'booking'
  AND stale_booking.cleaning_status NOT IN ('clean', 'not_needed')
  AND EXISTS (
    SELECT 1
    FROM public.vihem_short_stay_bookings newer_booking
    WHERE newer_booking.organisation_id = stale_booking.organisation_id
      AND newer_booking.unit_id = stale_booking.unit_id
      AND newer_booking.booking_type = 'booking'
      AND newer_booking.start_date <= CURRENT_DATE
      AND newer_booking.start_date > stale_booking.end_date
  );
