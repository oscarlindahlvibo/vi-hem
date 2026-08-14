ALTER TABLE public.vihem_sms_settings
  ADD COLUMN IF NOT EXISTS encrypted_username text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS encrypted_password text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS encrypted_api_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS username_hint text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS api_url_hint text NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
