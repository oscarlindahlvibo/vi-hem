-- Extends the per-staff module-grant mechanism (vihem_permission_grants,
-- vihem_has_permission -- see 20260901130000_operations_module_and_permissions.sql)
-- to Ekonomi (finance), Skatteverket and a new Löneunderlag/payroll module.
-- These three were previously excluded from AdminStaffPage.tsx's grantable
-- list because their RLS was hard-locked to role='admin' -- an admin could
-- tick a "Ekonomi" checkbox for a staff member and it would do nothing.
-- This migration makes the checkbox actually work, so every optional
-- module follows the same one consistent per-person grant pattern.
--
-- Scope: this opens day-to-day finance/tax/payroll DATA (invoices,
-- customers/suppliers, payments, tax obligations/events, everyone's time
-- entries for payroll) to a granted staff member -- the same level of
-- access an org admin has. It deliberately leaves untouched: who can grant
-- vihem_company_user_permissions rows, vihem_companies writes,
-- vihem_finance_automation_runs/settings, and vihem_finance_audit_log --
-- those stay admin/superadmin-only since they're org configuration and the
-- audit trail *of* finance activity, not finance work itself.

-- 1) New 'payroll' module -- Löneunderlag had no module key at all before
--    this (AdminPayrollPage was gated purely on role='admin' in App.tsx).
INSERT INTO public.vihem_module_registry (
  module_key, name, description, category, default_enabled, default_limits, default_settings, sort_order
)
VALUES (
  'payroll',
  'Löneunderlag',
  'Sammanställd arbetstid för alla anställda, underlag för lönekörning.',
  'finance',
  true,
  '{}'::jsonb,
  '{}'::jsonb,
  191
)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_limits = EXCLUDED.default_limits,
  default_settings = EXCLUDED.default_settings,
  updated_at = now();

-- Löneunderlag was previously reachable by every admin unconditionally (no
-- module gate existed at all) -- seed it org-wide *enabled* so this
-- migration only adds the new per-staff grant requirement on top, instead
-- of silently taking payroll access away from admins who already had it.
INSERT INTO public.vihem_organisation_modules (organisation_id, module_key, enabled, limits, settings)
SELECT o.id, 'payroll', true, r.default_limits, r.default_settings
FROM public.vihem_organisations o
JOIN public.vihem_module_registry r ON r.module_key = 'payroll'
ON CONFLICT (organisation_id, module_key) DO NOTHING;

-- 2) Core finance tables (invoices, customers/suppliers, payments, ...)
--    already support staff via vihem_company_user_permissions/
--    vihem_user_has_company_access -- the missing piece is that only an
--    admin can create those per-company rows. Give module.finance grant
--    holders the same org-wide bypass admins already get here, so ticking
--    the "Ekonomi" checkbox is sufficient on its own (no need to also
--    grant per-company roles one by one).
CREATE OR REPLACE FUNCTION public.vihem_user_has_company_access(target_company_id uuid, required_role text DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH role_rank AS (
    SELECT * FROM (VALUES ('viewer',1),('seller',2),('bookkeeper',3),('approver',4),('admin',5)) AS roles(role_key, rank)
  ),
  current_required AS (SELECT COALESCE((SELECT rank FROM role_rank WHERE role_key = required_role), 1) AS rank)
  SELECT
    public.vihem_get_my_role() = 'superadmin'
    OR (target_company_id IS NULL AND public.vihem_get_my_role() = 'admin')
    OR (target_company_id IS NULL AND public.vihem_has_permission(auth.uid(), 'module.finance'))
    OR EXISTS (
      SELECT 1 FROM public.vihem_companies c
      WHERE c.id = target_company_id
        AND c.organisation_id = public.vihem_get_my_org_id()
        AND public.vihem_get_my_role() = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.vihem_companies c
      WHERE c.id = target_company_id
        AND c.organisation_id = public.vihem_get_my_org_id()
        AND public.vihem_has_permission(auth.uid(), 'module.finance')
    )
    OR EXISTS (
      SELECT 1 FROM public.vihem_company_user_permissions cup
      JOIN role_rank rr ON rr.role_key = cup.role
      CROSS JOIN current_required cr
      WHERE cup.company_id = target_company_id
        AND cup.user_id = auth.uid()
        AND cup.active = true
        AND rr.rank >= cr.rank
    );
$$;

-- 3) Skatteverket -- no company-scoped fallback exists at all today, every
--    policy is a flat admin/superadmin check. Add module.skatteverket as
--    an alternate path on all six.
DROP POLICY IF EXISTS "Skatteverket integrations admin" ON public.vihem_skatteverket_integrations;
CREATE POLICY "Skatteverket integrations admin" ON public.vihem_skatteverket_integrations
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket'));

DROP POLICY IF EXISTS "Skatteverket obligations company read" ON public.vihem_tax_obligations;
CREATE POLICY "Skatteverket obligations company read" ON public.vihem_tax_obligations
  FOR SELECT TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket') AND public.vihem_user_has_company_access(company_id, 'viewer'));

DROP POLICY IF EXISTS "Skatteverket obligations admin write" ON public.vihem_tax_obligations;
CREATE POLICY "Skatteverket obligations admin write" ON public.vihem_tax_obligations
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket'));

DROP POLICY IF EXISTS "Skatteverket events company read" ON public.vihem_tax_events;
CREATE POLICY "Skatteverket events company read" ON public.vihem_tax_events
  FOR SELECT TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket') AND public.vihem_user_has_company_access(company_id, 'viewer'));

DROP POLICY IF EXISTS "Skatteverket events admin write" ON public.vihem_tax_events;
CREATE POLICY "Skatteverket events admin write" ON public.vihem_tax_events
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket'));

DROP POLICY IF EXISTS "Skatteverket sync runs admin" ON public.vihem_tax_sync_runs;
CREATE POLICY "Skatteverket sync runs admin" ON public.vihem_tax_sync_runs
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket'));

DROP POLICY IF EXISTS "Skatteverket oauth admin" ON public.vihem_skatteverket_oauth_states;
CREATE POLICY "Skatteverket oauth admin" ON public.vihem_skatteverket_oauth_states
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND (public.vihem_get_my_role() IN ('admin', 'superadmin') OR public.vihem_has_permission(auth.uid(), 'module.skatteverket')) AND public.vihem_module_enabled('skatteverket'));

-- 4) Payroll -- vihem_time_entries' "see/edit everyone in my org" policies
--    use the legacy get_my_role() (not vihem_get_my_role()), so match that
--    directly rather than mixing helper functions on the same table.
DROP POLICY IF EXISTS "Admin can read own org time entries" ON public.vihem_time_entries;
CREATE POLICY "Admin can read own org time entries" ON public.vihem_time_entries
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id() AND (get_my_role() = 'admin' OR vihem_has_permission(auth.uid(), 'module.payroll')));

DROP POLICY IF EXISTS "Staff can update own or admin all time entries" ON public.vihem_time_entries;
CREATE POLICY "Staff can update own or admin all time entries" ON public.vihem_time_entries
  FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND (organisation_id IS NULL OR organisation_id = get_my_org_id()))
    OR (organisation_id = get_my_org_id() AND (get_my_role() = 'admin' OR vihem_has_permission(auth.uid(), 'module.payroll')))
  )
  WITH CHECK (
    (user_id = auth.uid() AND (organisation_id IS NULL OR organisation_id = get_my_org_id()))
    OR (organisation_id = get_my_org_id() AND (get_my_role() = 'admin' OR vihem_has_permission(auth.uid(), 'module.payroll')))
  );

DROP POLICY IF EXISTS "Admins can insert org time entries" ON public.vihem_time_entries;
CREATE POLICY "Admins can insert org time entries" ON public.vihem_time_entries
  FOR INSERT TO authenticated
  WITH CHECK (organisation_id = get_my_org_id() AND (get_my_role() IN ('admin', 'superadmin') OR vihem_has_permission(auth.uid(), 'module.payroll')));

DROP POLICY IF EXISTS "Admins can delete org time entries" ON public.vihem_time_entries;
CREATE POLICY "Admins can delete org time entries" ON public.vihem_time_entries
  FOR DELETE TO authenticated
  USING (organisation_id = get_my_org_id() AND (get_my_role() IN ('admin', 'superadmin') OR vihem_has_permission(auth.uid(), 'module.payroll')));

NOTIFY pgrst, 'reload schema';
