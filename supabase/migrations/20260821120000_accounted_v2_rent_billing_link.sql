/*
  # Accounted V2 rent billing link

  Lets a rent billing item be invoiced through the new Accounted integration
  instead of (or in addition to, over time) the legacy vihem_invoices path.
  Purely additive: the existing invoice_id column, vihem_generate_rent_invoices
  RPC, and the adjustments triggers are untouched, so legacy rent invoicing
  keeps working exactly as before for any company not yet on Finance V2.

  A billing item can only ever be invoiced through ONE path -- the finance
  V2 batch function only picks up items where both invoice_id and
  accounted_invoice_link_id are null, so there's no risk of double-invoicing
  the same item through legacy and V2.
*/

ALTER TABLE public.vihem_rent_billing_items
  ADD COLUMN IF NOT EXISTS accounted_invoice_link_id uuid
    REFERENCES public.vihem_accounted_invoice_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vihem_rent_billing_items_accounted_invoice_link_idx
  ON public.vihem_rent_billing_items (accounted_invoice_link_id);
