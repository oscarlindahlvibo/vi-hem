/*
  # VI-HEM finance accounting sync automation settings

  Extends the organisation-level finance automation settings with controls for
  scheduled accounting sync queue processing.
*/

ALTER TABLE public.vihem_finance_automation_settings
  ADD COLUMN IF NOT EXISTS process_accounting_sync boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accounting_sync_limit integer NOT NULL DEFAULT 50
    CHECK (accounting_sync_limit BETWEEN 1 AND 200);

NOTIFY pgrst, 'reload schema';
