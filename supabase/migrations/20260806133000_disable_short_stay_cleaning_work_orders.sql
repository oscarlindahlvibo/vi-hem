-- Korttidsuthyrning ska inte skapa vanliga arbetsordrar för städ.
-- Städbehovet lever på bokningen tills personal sveper den som städad.

DROP TRIGGER IF EXISTS trg_vihem_short_stay_cleaning_work_order ON public.vihem_short_stay_bookings;

CREATE OR REPLACE FUNCTION public.vihem_sync_short_stay_cleaning_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_archive_stale_short_stay_cleaning_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 0;
END;
$$;

UPDATE public.vihem_work_orders
SET
  status = 'cancelled',
  updated_at = now()
WHERE category = 'cleaning'
  AND status NOT IN ('completed', 'cancelled')
  AND (
    short_stay_booking_id IS NOT NULL
    OR title ILIKE 'Städ korttidsuthyrning:%'
    OR COALESCE(tags, ARRAY[]::text[]) && ARRAY['korttidsuthyrning', 'städ', 'utcheckning']::text[]
  );

UPDATE public.vihem_short_stay_bookings
SET
  cleaning_work_order_id = NULL,
  updated_at = now()
WHERE cleaning_work_order_id IS NOT NULL;
