-- Korttidsuthyrning: driftkalender, gästantal/kapacitet och automatisk städarbetsorder

ALTER TABLE public.vihem_short_stay_units
  ADD COLUMN IF NOT EXISTS max_guests integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS beds24_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS beds24_property_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS beds24_room_id text NOT NULL DEFAULT '';

ALTER TABLE public.vihem_short_stay_bookings
  ADD COLUMN IF NOT EXISTS arrival_time time,
  ADD COLUMN IF NOT EXISTS departure_time time,
  ADD COLUMN IF NOT EXISTS cleaning_work_order_id uuid REFERENCES public.vihem_work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vihem_short_stay_bookings_cleaning_work_order
  ON public.vihem_short_stay_bookings(cleaning_work_order_id);

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

  IF NEW.cleaning_status IN ('clean', 'not_needed') THEN
    IF NEW.cleaning_work_order_id IS NOT NULL THEN
      UPDATE public.vihem_work_orders
      SET status = CASE WHEN NEW.cleaning_status = 'clean' THEN 'completed' ELSE status END,
          completed_at = CASE WHEN NEW.cleaning_status = 'clean' THEN COALESCE(completed_at, now()) ELSE completed_at END,
          updated_at = now()
      WHERE id = NEW.cleaning_work_order_id;
    END IF;
    RETURN NEW;
  END IF;

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
    WHERE id = NEW.cleaning_work_order_id;
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
