ALTER TABLE public.vihem_short_stay_bookings
  ADD COLUMN IF NOT EXISTS total_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_due numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SEK',
  ADD COLUMN IF NOT EXISTS price_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.vihem_short_stay_bookings
SET
  balance_due = GREATEST(COALESCE(total_price, 0) - COALESCE(paid_amount, 0), 0),
  currency = COALESCE(NULLIF(currency, ''), 'SEK'),
  price_breakdown = COALESCE(price_breakdown, '{}'::jsonb);
