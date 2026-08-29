-- Kritisk fix: vihem_apartment_inspections (besiktningar) och
-- vihem_contract_signatures (hyresavtal) hade RLS-policies som bara
-- kontrollerade rollen (staff/admin/superadmin), aldrig organisation_id --
-- vilket gjorde att personal i EN organisation kunde läsa, skapa, ändra och
-- (för avtal) radera besiktningar och hyresavtal i ALLA organisationer.
-- vihem_termination_requests hade samma hål på läs/uppdatera.
--
-- organisation_id sattes dessutom aldrig av frontend vid insert på de två
-- första tabellerna (bara kolumnen fanns, aldrig ifylld), så alla
-- befintliga rader har organisation_id = NULL. Backfilla dem via
-- apartment/tenancy innan de nya organisationsskopade policyerna aktiveras,
-- annars blir all historisk data osynlig istället för bara korrekt skopad.

-- ── Backfill befintliga rader ────────────────────────────────────────────
UPDATE vihem_apartment_inspections ai
SET organisation_id = a.organisation_id
FROM vihem_apartments a
WHERE ai.apartment_id = a.id AND ai.organisation_id IS NULL;

UPDATE vihem_contract_signatures cs
SET organisation_id = t.organisation_id
FROM vihem_tenancies t
WHERE cs.tenancy_id = t.id AND cs.organisation_id IS NULL;

UPDATE vihem_termination_requests tr
SET organisation_id = p.organisation_id
FROM vihem_profiles p
WHERE tr.tenant_id = p.id AND tr.organisation_id IS NULL;

-- ── Tvinga fram organisation_id vid insert (skydd mot att frontend glömmer
--    det igen, precis det som orsakade det här hålet) ───────────────────
CREATE OR REPLACE FUNCTION vihem_set_organisation_id_from_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.organisation_id := get_my_org_id();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_organisation_id ON vihem_apartment_inspections;
CREATE TRIGGER set_organisation_id
  BEFORE INSERT ON vihem_apartment_inspections
  FOR EACH ROW EXECUTE FUNCTION vihem_set_organisation_id_from_session();

DROP TRIGGER IF EXISTS set_organisation_id ON vihem_contract_signatures;
CREATE TRIGGER set_organisation_id
  BEFORE INSERT ON vihem_contract_signatures
  FOR EACH ROW EXECUTE FUNCTION vihem_set_organisation_id_from_session();

-- ── vihem_apartment_inspections: organisationsskopa läs/skapa/uppdatera ──
DROP POLICY IF EXISTS "Staff can view all inspections" ON vihem_apartment_inspections;
CREATE POLICY "Org staff can read own org inspections" ON vihem_apartment_inspections
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin']));
CREATE POLICY "Superadmin can read all inspections" ON vihem_apartment_inspections
  FOR SELECT TO authenticated
  USING (get_my_role() = 'superadmin');
CREATE POLICY "Tenant can read own inspections" ON vihem_apartment_inspections
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM vihem_tenancies WHERE vihem_tenancies.id = vihem_apartment_inspections.tenancy_id AND vihem_tenancies.tenant_id = auth.uid()));

DROP POLICY IF EXISTS "Staff can insert inspections" ON vihem_apartment_inspections;
CREATE POLICY "Staff can insert own org inspections" ON vihem_apartment_inspections
  FOR INSERT TO authenticated
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin']));

DROP POLICY IF EXISTS "Staff can update inspections" ON vihem_apartment_inspections;
CREATE POLICY "Staff can update own org inspections" ON vihem_apartment_inspections
  FOR UPDATE TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin']))
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin']));

-- ── vihem_contract_signatures: organisationsskopa läs/skapa/uppdatera/radera ──
DROP POLICY IF EXISTS "Tenants can view own contracts" ON vihem_contract_signatures;
CREATE POLICY "Org staff can read own org contracts" ON vihem_contract_signatures
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin']));
CREATE POLICY "Superadmin can read all contracts" ON vihem_contract_signatures
  FOR SELECT TO authenticated
  USING (get_my_role() = 'superadmin');
CREATE POLICY "Tenant can read own contracts" ON vihem_contract_signatures
  FOR SELECT TO authenticated
  USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Staff can insert contracts" ON vihem_contract_signatures;
CREATE POLICY "Staff can insert own org contracts" ON vihem_contract_signatures
  FOR INSERT TO authenticated
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin']));

DROP POLICY IF EXISTS "Staff and tenants can update contracts" ON vihem_contract_signatures;
CREATE POLICY "Staff can update own org contracts" ON vihem_contract_signatures
  FOR UPDATE TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin']))
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin']));
CREATE POLICY "Tenant can update own contracts" ON vihem_contract_signatures
  FOR UPDATE TO authenticated
  USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Admin can delete contracts" ON vihem_contract_signatures;
CREATE POLICY "Admin can delete own org contracts" ON vihem_contract_signatures
  FOR DELETE TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['admin', 'superadmin']));

-- ── vihem_termination_requests: organisationsskopa läs/uppdatera ────────
DROP POLICY IF EXISTS "Staff can read all termination requests" ON vihem_termination_requests;
CREATE POLICY "Org staff can read own org termination requests" ON vihem_termination_requests
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin']));
CREATE POLICY "Superadmin can read all termination requests" ON vihem_termination_requests
  FOR SELECT TO authenticated
  USING (get_my_role() = 'superadmin');

DROP POLICY IF EXISTS "Admin can update termination requests" ON vihem_termination_requests;
CREATE POLICY "Admin can update own org termination requests" ON vihem_termination_requests
  FOR UPDATE TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['admin', 'superadmin']))
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['admin', 'superadmin']));
