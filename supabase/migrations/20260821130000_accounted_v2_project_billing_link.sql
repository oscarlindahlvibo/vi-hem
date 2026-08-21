/*
  # Accounted V2 customer-project billing link

  Mirrors the rent-billing link (20260821120000): lets a project invoice
  basis be invoiced through the new Accounted integration instead of the
  legacy vihem_invoices path, without touching vihem_create_invoice_from_
  project_basis(_batch) or vihem_ensure_finance_customer_for_project, which
  keep working unchanged for any company not yet on Finance V2.

  A basis can only ever be invoiced through ONE path -- the finance V2
  function only picks up bases where both finance_invoice_id (legacy) and
  accounted_invoice_link_id (V2) are still null, so there's no risk of
  double-invoicing the same underlag.
*/

ALTER TABLE public.vihem_project_invoice_basis
  ADD COLUMN IF NOT EXISTS accounted_invoice_link_id uuid
    REFERENCES public.vihem_accounted_invoice_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vihem_project_invoice_basis_accounted_invoice_link_idx
  ON public.vihem_project_invoice_basis (accounted_invoice_link_id);
