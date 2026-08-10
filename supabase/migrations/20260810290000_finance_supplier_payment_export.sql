/*
  # Supplier payment export foundation

  Adds supplier payment details and export metadata so scheduled supplier
  invoices can be exported to bank/payment files without losing traceability.
*/

ALTER TABLE public.vihem_finance_suppliers
  ADD COLUMN IF NOT EXISTS bankgiro text DEFAULT '',
  ADD COLUMN IF NOT EXISTS plusgiro text DEFAULT '',
  ADD COLUMN IF NOT EXISTS iban text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bic text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_account text DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_reference text DEFAULT '';

ALTER TABLE public.vihem_supplier_invoices
  ADD COLUMN IF NOT EXISTS payment_reference text DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_exported_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_export_id text DEFAULT '';

CREATE INDEX IF NOT EXISTS vihem_supplier_invoices_payment_export_idx
  ON public.vihem_supplier_invoices (organisation_id, company_id, payment_status, due_date)
  WHERE payment_status = 'scheduled';
