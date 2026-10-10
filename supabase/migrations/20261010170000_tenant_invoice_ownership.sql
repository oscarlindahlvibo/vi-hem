BEGIN;
-- Check ownership without exposing billing items or their internal notes.
-- The old policy's EXISTS ran under caller RLS and could not see those items.
CREATE OR REPLACE FUNCTION public.vihem_owns_rent_invoice(invoice_link_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vihem_accounted_invoice_links link
    JOIN public.vihem_rent_billing_items item ON item.id = link.source_id
    JOIN public.vihem_profiles caller ON caller.id = auth.uid()
    JOIN public.vihem_accounted_company_links company ON company.id = link.company_link_id
    WHERE link.id = invoice_link_id AND link.source_type = 'rental_billing'
      AND item.tenant_id = auth.uid() AND caller.active IS TRUE
      AND caller.organisation_id = link.organisation_id
      AND item.organisation_id = link.organisation_id
      AND company.organisation_id = link.organisation_id
  );
$$;
REVOKE ALL ON FUNCTION public.vihem_owns_rent_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vihem_owns_rent_invoice(uuid) TO authenticated;

DROP POLICY IF EXISTS "VIHEM accounted links read" ON public.vihem_accounted_invoice_links;
CREATE POLICY "VIHEM accounted links read"
  ON public.vihem_accounted_invoice_links FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND EXISTS (
      SELECT 1 FROM public.vihem_accounted_company_links l
      WHERE l.id = vihem_accounted_invoice_links.company_link_id
        AND public.vihem_user_has_company_access(l.company_id, 'viewer')
    ))
    OR public.vihem_owns_rent_invoice(id)
  );

COMMIT;
