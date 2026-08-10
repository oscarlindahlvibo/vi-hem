/*
  # VI-HEM accounting integration secret metadata

  Adds non-sensitive secret status metadata to the public integration row so
  admins can see whether a token exists without reading the encrypted secret.
*/

ALTER TABLE public.vihem_accounting_integrations
  ADD COLUMN IF NOT EXISTS has_secret boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS secret_hint text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS secret_rotated_at timestamptz;

UPDATE public.vihem_accounting_integrations integration
SET
  has_secret = true,
  secret_hint = secret.secret_hint,
  secret_rotated_at = secret.rotated_at
FROM public.vihem_accounting_integration_secrets secret
WHERE secret.integration_id = integration.id;

NOTIFY pgrst, 'reload schema';
