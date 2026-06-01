/*
  # Organisation-scoped RLS policies

  Replaces global role-based policies with organisation-scoped equivalents.
*/

-- ── Helper: get current user's organisation_id ─────────────────────────────
CREATE OR REPLACE FUNCTION get_my_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT organisation_id FROM profiles WHERE id = auth.uid();
$$;

-- ── properties ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can read properties" ON properties;
DROP POLICY IF EXISTS "Admin can insert properties" ON properties;
DROP POLICY IF EXISTS "Admin can update properties" ON properties;

CREATE POLICY "Org members can read own org properties"
  ON properties FOR SELECT
  TO authenticated
  USING (organisation_id = get_my_org_id());

CREATE POLICY "Admin can insert own org properties"
  ON properties FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = 'admin' AND
    organisation_id = get_my_org_id()
  );

CREATE POLICY "Admin can update own org properties"
  ON properties FOR UPDATE
  TO authenticated
  USING (get_my_role() = 'admin' AND organisation_id = get_my_org_id())
  WITH CHECK (get_my_role() = 'admin' AND organisation_id = get_my_org_id());

-- ── apartments ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can read apartments" ON apartments;
DROP POLICY IF EXISTS "Tenant can read own apartment" ON apartments;
DROP POLICY IF EXISTS "Admin can insert apartments" ON apartments;
DROP POLICY IF EXISTS "Admin can update apartments" ON apartments;

CREATE POLICY "Org staff can read own org apartments"
  ON apartments FOR SELECT
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']));

CREATE POLICY "Tenant can read own apartment"
  ON apartments FOR SELECT
  TO authenticated
  USING (id IN (SELECT apartment_id FROM tenancies WHERE tenant_id = auth.uid() AND status = 'active'));

CREATE POLICY "Admin can insert own org apartments"
  ON apartments FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() = 'admin' AND organisation_id = get_my_org_id());

CREATE POLICY "Admin can update own org apartments"
  ON apartments FOR UPDATE
  TO authenticated
  USING (get_my_role() = 'admin' AND organisation_id = get_my_org_id())
  WITH CHECK (get_my_role() = 'admin' AND organisation_id = get_my_org_id());

-- ── tenancies ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can read all tenancies" ON tenancies;
DROP POLICY IF EXISTS "Admin can insert tenancies" ON tenancies;
DROP POLICY IF EXISTS "Admin can update tenancies" ON tenancies;

CREATE POLICY "Org staff can read own org tenancies"
  ON tenancies FOR SELECT
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']));

CREATE POLICY "Admin can insert own org tenancies"
  ON tenancies FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() = 'admin' AND organisation_id = get_my_org_id());

CREATE POLICY "Admin can update own org tenancies"
  ON tenancies FOR UPDATE
  TO authenticated
  USING (get_my_role() = 'admin' AND organisation_id = get_my_org_id())
  WITH CHECK (get_my_role() = 'admin' AND organisation_id = get_my_org_id());

-- ── maintenance_requests ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can read all maintenance requests" ON maintenance_requests;
DROP POLICY IF EXISTS "Staff can update maintenance requests" ON maintenance_requests;

CREATE POLICY "Org staff can read own org maintenance requests"
  ON maintenance_requests FOR SELECT
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']));

CREATE POLICY "Org staff can update own org maintenance requests"
  ON maintenance_requests FOR UPDATE
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']))
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']));

-- ── work_orders ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can read all work orders" ON work_orders;
DROP POLICY IF EXISTS "Staff can insert work orders" ON work_orders;
DROP POLICY IF EXISTS "Staff can update work orders" ON work_orders;

CREATE POLICY "Org staff can read own org work orders"
  ON work_orders FOR SELECT
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']));

CREATE POLICY "Org staff can insert own org work orders"
  ON work_orders FOR INSERT
  TO authenticated
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']));

CREATE POLICY "Org staff can update own org work orders"
  ON work_orders FOR UPDATE
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']))
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']));

-- ── time_entries ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin can read all time entries" ON time_entries;
DROP POLICY IF EXISTS "Staff can update own time entries" ON time_entries;

CREATE POLICY "Admin can read own org time entries"
  ON time_entries FOR SELECT
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = 'admin');

CREATE POLICY "Staff can update own or admin all time entries"
  ON time_entries FOR UPDATE
  TO authenticated
  USING (organisation_id = get_my_org_id() AND (user_id = auth.uid() OR get_my_role() = 'admin'))
  WITH CHECK (organisation_id = get_my_org_id() AND (user_id = auth.uid() OR get_my_role() = 'admin'));

-- ── profiles ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can insert profiles" ON profiles;

CREATE POLICY "Org staff can read own org profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']));

CREATE POLICY "Admin can insert own org profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() = 'admin' AND organisation_id = get_my_org_id());

CREATE POLICY "Admin can update own org profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (get_my_role() = 'admin' AND organisation_id = get_my_org_id())
  WITH CHECK (get_my_role() = 'admin' AND organisation_id = get_my_org_id());
