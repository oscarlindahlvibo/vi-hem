-- Let staff work operationally with customer projects in their organisation.
-- Billing, quotes and invoice screens remain admin-only in the app.

CREATE OR REPLACE FUNCTION public.can_access_customer_project(project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vihem_customer_projects cp
    WHERE cp.id = project_id
      AND cp.organisation_id = public.get_my_org_id()
      AND public.is_customer_projects_enabled(cp.organisation_id)
      AND public.get_my_role() = ANY (ARRAY['staff','admin'])
  );
$$;

DROP POLICY IF EXISTS "Org users can read enabled customer projects" ON public.vihem_customer_projects;
CREATE POLICY "Org users can read enabled customer projects"
  ON public.vihem_customer_projects FOR SELECT
  TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.is_customer_projects_enabled(organisation_id)
    AND public.get_my_role() = ANY (ARRAY['staff','admin'])
  );

DROP POLICY IF EXISTS "Project users can read quote versions" ON public.vihem_project_quote_versions;
DROP POLICY IF EXISTS "Admins can read quote versions" ON public.vihem_project_quote_versions;
CREATE POLICY "Admins can read quote versions"
  ON public.vihem_project_quote_versions FOR SELECT
  TO authenticated
  USING (
    public.can_access_customer_project(project_id)
    AND public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "Project users can read quote lines" ON public.vihem_project_quote_lines;
DROP POLICY IF EXISTS "Admins can read quote lines" ON public.vihem_project_quote_lines;
CREATE POLICY "Admins can read quote lines"
  ON public.vihem_project_quote_lines FOR SELECT
  TO authenticated
  USING (
    public.get_my_role() = 'admin'
    AND EXISTS (
      SELECT 1
      FROM public.vihem_project_quote_versions qv
      WHERE qv.id = vihem_project_quote_lines.quote_version_id
        AND public.can_access_customer_project(qv.project_id)
    )
  );

DROP POLICY IF EXISTS "Project members can read invoice basis" ON public.vihem_project_invoice_basis;
DROP POLICY IF EXISTS "Admins can read invoice basis" ON public.vihem_project_invoice_basis;
CREATE POLICY "Admins can read invoice basis"
  ON public.vihem_project_invoice_basis FOR SELECT
  TO authenticated
  USING (
    public.can_access_customer_project(project_id)
    AND public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS "Project members can read invoice basis lines" ON public.vihem_project_invoice_basis_lines;
DROP POLICY IF EXISTS "Admins can read invoice basis lines" ON public.vihem_project_invoice_basis_lines;
CREATE POLICY "Admins can read invoice basis lines"
  ON public.vihem_project_invoice_basis_lines FOR SELECT
  TO authenticated
  USING (
    public.get_my_role() = 'admin'
    AND EXISTS (
      SELECT 1
      FROM public.vihem_project_invoice_basis pib
      WHERE pib.id = vihem_project_invoice_basis_lines.basis_id
        AND public.can_access_customer_project(pib.project_id)
    )
  );

DROP POLICY IF EXISTS "Project members can read activity" ON public.vihem_project_activity_log;
DROP POLICY IF EXISTS "Admins can read project activity" ON public.vihem_project_activity_log;
CREATE POLICY "Admins can read project activity"
  ON public.vihem_project_activity_log FOR SELECT
  TO authenticated
  USING (
    public.can_access_customer_project(project_id)
    AND public.get_my_role() = 'admin'
  );
