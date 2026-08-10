/*
  # Backfill prepaid short-stay channel bookings

  Channel bookings from Airbnb, Booking, Expedia/Hotels.com and Vrbo/HomeAway
  are prepaid to the channel. Keep historical imports aligned with that rule and
  repair linked finance invoices that may have been created before the guard.
*/

WITH prepaid_bookings AS (
  SELECT
    id,
    finance_invoice_id,
    COALESCE(NULLIF(total_price, 0), paid_amount, 0) AS amount
  FROM public.vihem_short_stay_bookings
  WHERE booking_type = 'booking'
    AND (
      lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%airbnb%'
      OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%booking%'
      OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%expedia%'
      OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%hotelscom%'
      OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%vrbo%'
      OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%homeaway%'
    )
)
UPDATE public.vihem_short_stay_bookings b
SET
  payment_status = 'paid',
  paid_amount = p.amount,
  balance_due = 0,
  updated_at = now()
FROM prepaid_bookings p
WHERE b.id = p.id
  AND p.amount > 0
  AND (
    b.payment_status <> 'paid'
    OR b.paid_amount IS DISTINCT FROM p.amount
    OR b.balance_due IS DISTINCT FROM 0
  );

WITH prepaid_bookings AS (
  SELECT
    id,
    finance_invoice_id,
    COALESCE(NULLIF(total_price, 0), paid_amount, 0) AS amount
  FROM public.vihem_short_stay_bookings
  WHERE finance_invoice_id IS NOT NULL
    AND booking_type = 'booking'
    AND (
      lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%airbnb%'
      OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%booking%'
      OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%expedia%'
      OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%hotelscom%'
      OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%vrbo%'
      OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%homeaway%'
    )
)
UPDATE public.vihem_invoices i
SET
  payment_status = 'paid',
  status = CASE WHEN i.status IN ('draft', 'approved', 'sent', 'overdue', 'partially_paid') THEN 'paid' ELSE i.status END,
  paid_amount = LEAST(p.amount, i.total_amount),
  balance_due = 0,
  paid_at = COALESCE(i.paid_at, now()),
  updated_at = now()
FROM prepaid_bookings p
WHERE i.id = p.finance_invoice_id
  AND p.amount > 0
  AND i.payment_status <> 'paid';
