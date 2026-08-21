/*
  # Tenant portal invoice view foundation

  Lets a tenant read their OWN Accounted-backed rent invoices directly from
  the local cache table (vihem_accounted_invoice_links), and adds the two
  date columns the portal needs (fakturadatum/förfallodatum) that weren't
  cached locally before now -- everything else the portal needs
  (fakturanummer, belopp, återstående belopp, status) already exists on the
  table.

  Accounted stays the source of truth; this is still just a synced
  projection for fast reads (per docs/accounted-v2-integration.md), refreshed
  by vihem-accounted-webhook / a manual refresh_status call, same as the
  admin-facing Finance V2 "Fakturor" tab.
*/

ALTER TABLE public.vihem_accounted_invoice_links
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS due_date date;

-- Tenant self-access: a tenant may read an invoice link if it's a rent
-- invoice (source_type = 'rental_billing') for a billing item that's theirs
-- (vihem_rent_billing_items.tenant_id = auth.uid()). Existing company-access
-- read policy is preserved unchanged as the other OR-branch -- staff/admin
-- still see everything for their company, a tenant additionally sees only
-- their own rows.
DROP POLICY IF EXISTS "VIHEM accounted links read" ON public.vihem_accounted_invoice_links;
CREATE POLICY "VIHEM accounted links read"
  ON public.vihem_accounted_invoice_links FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND EXISTS (
      SELECT 1 FROM public.vihem_accounted_company_links l
      WHERE l.id = vihem_accounted_invoice_links.company_link_id AND public.vihem_user_has_company_access(l.company_id, 'viewer')
    ))
    OR (
      source_type = 'rental_billing'
      AND EXISTS (
        SELECT 1 FROM public.vihem_rent_billing_items item
        WHERE item.id = vihem_accounted_invoice_links.source_id
          AND item.tenant_id = auth.uid()
      )
    )
  );
