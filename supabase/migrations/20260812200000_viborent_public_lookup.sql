-- Secure public lookup for bookings created by ViboRent.
ALTER TABLE public.vihem_rental_bookings
  ADD COLUMN IF NOT EXISTS public_lookup_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS vihem_rental_bookings_lookup_token_idx
  ON public.vihem_rental_bookings(public_lookup_token);

NOTIFY pgrst, 'reload schema';
