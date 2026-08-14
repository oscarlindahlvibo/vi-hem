-- Cellsynt delivery reports update the existing SMS audit trail.
-- The token is a bearer credential for Cellsynt's callback URL and is never
-- exposed through the public REST API.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.vihem_sms_messages
  DROP CONSTRAINT IF EXISTS vihem_sms_messages_status_check;

ALTER TABLE public.vihem_sms_messages
  ADD CONSTRAINT vihem_sms_messages_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'delivery_failed', 'failed'));

ALTER TABLE public.vihem_sms_messages
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_raw text NOT NULL DEFAULT '';

ALTER TABLE public.vihem_sms_settings
  ADD COLUMN IF NOT EXISTS delivery_report_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ADD COLUMN IF NOT EXISTS delivery_report_enabled boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS vihem_sms_settings_delivery_token_uidx
  ON public.vihem_sms_settings(delivery_report_token);

NOTIFY pgrst, 'reload schema';
