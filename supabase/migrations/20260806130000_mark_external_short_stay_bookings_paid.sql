-- Externa korttidskanaler betalas via leverantören och ska inte ligga som obetalda i VI-HEM.

UPDATE public.vihem_short_stay_bookings
SET payment_status = 'paid',
    paid_amount = CASE
      WHEN COALESCE(total_price, 0) > 0 THEN total_price
      ELSE COALESCE(paid_amount, 0)
    END,
    balance_due = 0,
    updated_at = now()
WHERE booking_type = 'booking'
  AND (
    lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%airbnb%'
    OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%booking%'
    OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%expedia%'
    OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%hotelscom%'
    OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%vrbo%'
    OR lower(regexp_replace(channel_name, '[\s._-]+', '', 'g')) LIKE '%homeaway%'
  );

