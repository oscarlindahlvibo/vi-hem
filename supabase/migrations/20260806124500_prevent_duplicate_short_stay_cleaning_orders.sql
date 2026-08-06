-- Förhindra dubbla städordrar när importerade korttidsbokningar uppdateras flera gånger.

ALTER TABLE public.vihem_work_orders
  ADD COLUMN IF NOT EXISTS short_stay_booking_id uuid REFERENCES public.vihem_short_stay_bookings(id) ON DELETE SET NULL;

UPDATE public.vihem_work_orders wo
SET short_stay_booking_id = booking.id
FROM public.vihem_short_stay_bookings booking
WHERE booking.cleaning_work_order_id = wo.id
  AND wo.short_stay_booking_id IS NULL;

WITH ranked_cleaning_orders AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        organisation_id,
        title,
        due_date,
        COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(apartment_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY
        CASE WHEN short_stay_booking_id IS NOT NULL THEN 0 ELSE 1 END,
        created_at ASC,
        id ASC
    ) AS duplicate_rank
  FROM public.vihem_work_orders
  WHERE category = 'cleaning'
    AND status NOT IN ('completed', 'cancelled')
    AND title ILIKE 'Städ korttidsuthyrning:%'
)
UPDATE public.vihem_work_orders wo
SET status = 'cancelled',
    updated_at = now()
FROM ranked_cleaning_orders ranked
WHERE ranked.id = wo.id
  AND ranked.duplicate_rank > 1;

WITH ranked_linked_cleaning_orders AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY short_stay_booking_id
      ORDER BY
        CASE WHEN status NOT IN ('completed', 'cancelled') THEN 0 ELSE 1 END,
        created_at ASC,
        id ASC
    ) AS duplicate_rank
  FROM public.vihem_work_orders
  WHERE short_stay_booking_id IS NOT NULL
    AND category = 'cleaning'
)
UPDATE public.vihem_work_orders wo
SET status = CASE WHEN wo.status IN ('completed', 'cancelled') THEN wo.status ELSE 'cancelled' END,
    short_stay_booking_id = NULL,
    updated_at = now()
FROM ranked_linked_cleaning_orders ranked
WHERE ranked.id = wo.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vihem_work_orders_one_cleaning_order_per_short_stay_booking
  ON public.vihem_work_orders(short_stay_booking_id)
  WHERE short_stay_booking_id IS NOT NULL;

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
  existing_work_order_id uuid;
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

  SELECT wo.id
  INTO existing_work_order_id
  FROM public.vihem_work_orders wo
  WHERE wo.short_stay_booking_id = NEW.id
    AND wo.category = 'cleaning'
  ORDER BY
    CASE WHEN wo.status NOT IN ('completed', 'cancelled') THEN 0 ELSE 1 END,
    wo.created_at ASC,
    wo.id ASC
  LIMIT 1;

  IF existing_work_order_id IS NOT NULL THEN
    NEW.cleaning_work_order_id := existing_work_order_id;
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

  scheduled_start := (NEW.end_date + time '11:00') AT TIME ZONE 'Europe/Stockholm';
  scheduled_end := (NEW.end_date + time '15:00') AT TIME ZONE 'Europe/Stockholm';
  order_priority := CASE WHEN scheduled_end < now() THEN 'urgent' ELSE 'normal' END;

  IF NEW.cleaning_status = 'clean' THEN
    IF NEW.cleaning_work_order_id IS NOT NULL THEN
      UPDATE public.vihem_work_orders
      SET status = 'completed',
          completed_at = COALESCE(completed_at, now()),
          short_stay_booking_id = NEW.id,
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
          short_stay_booking_id = NEW.id,
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
      short_stay_booking_id,
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
      NEW.id,
      checklist_items,
      '[]'::jsonb,
      '[]'::jsonb,
      now(),
      now()
    )
    ON CONFLICT (short_stay_booking_id) WHERE short_stay_booking_id IS NOT NULL
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      priority = EXCLUDED.priority,
      property_id = EXCLUDED.property_id,
      apartment_id = EXCLUDED.apartment_id,
      due_date = EXCLUDED.due_date,
      scheduled_start_at = EXCLUDED.scheduled_start_at,
      scheduled_end_at = EXCLUDED.scheduled_end_at,
      updated_at = now()
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
        short_stay_booking_id = NEW.id,
        updated_at = now()
    WHERE id = NEW.cleaning_work_order_id
      AND status NOT IN ('completed', 'cancelled');
  END IF;

  RETURN NEW;
END;
$$;
