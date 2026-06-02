DROP POLICY IF EXISTS "Org staff can insert generated documents" ON documents;
DROP POLICY IF EXISTS "Org staff can update generated documents" ON documents;
DROP POLICY IF EXISTS "Tenant can insert own generated documents" ON documents;

CREATE POLICY "Org staff can insert generated documents"
  ON documents FOR INSERT
  TO authenticated
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin'])
  );

CREATE POLICY "Org staff can update generated documents"
  ON documents FOR UPDATE
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin'])
  )
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['staff', 'admin', 'superadmin'])
  );

CREATE POLICY "Tenant can insert own generated documents"
  ON documents FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = auth.uid()
    AND created_by = auth.uid()
    AND visibility = 'tenant'
    AND document_type = ANY (ARRAY['contract', 'inspection'])
    AND organisation_id = get_my_org_id()
  );
