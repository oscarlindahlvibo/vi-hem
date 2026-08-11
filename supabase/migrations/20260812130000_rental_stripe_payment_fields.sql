ALTER TABLE public.vihem_rental_bookings
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_payment_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS vihem_rental_bookings_payment_idx
  ON public.vihem_rental_bookings(organisation_id, payment_provider, payment_status);

NOTIFY pgrst, 'reload schema';
