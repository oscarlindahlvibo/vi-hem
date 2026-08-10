/*
  # Supplier invoice accounting status

  Keeps supplier invoice accounting queue state in the same shape as customer
  invoices, so Edge Functions and UI can mark supplier invoices as pending,
  synced or failed.
*/

ALTER TABLE public.vihem_supplier_invoices
  ADD COLUMN IF NOT EXISTS accounting_status text NOT NULL DEFAULT 'not_synced'
    CHECK (accounting_status IN ('not_synced', 'pending', 'synced', 'failed'));

CREATE INDEX IF NOT EXISTS vihem_supplier_invoices_accounting_status_idx
  ON public.vihem_supplier_invoices (company_id, accounting_status);

NOTIFY pgrst, 'reload schema';
