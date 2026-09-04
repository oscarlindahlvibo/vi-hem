-- Beds24's /inventory/fixedPrices rules are addressed by an id it assigns
-- on creation; without storing that id back, every price sync would create
-- a fresh duplicate rule on Beds24 instead of updating the existing one.
ALTER TABLE public.vihem_short_stay_los_discounts
  ADD COLUMN IF NOT EXISTS beds24_fixed_price_id text;
