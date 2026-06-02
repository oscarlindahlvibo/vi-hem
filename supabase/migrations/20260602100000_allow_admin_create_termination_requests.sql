DROP POLICY IF EXISTS "Admin can insert own org termination requests" ON termination_requests;

CREATE POLICY "Admin can insert own org termination requests"
  ON termination_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = 'admin'
    AND organisation_id = get_my_org_id()
    AND tenant_id IN (
      SELECT id
      FROM profiles
      WHERE role = 'tenant'
        AND organisation_id = get_my_org_id()
    )
    AND (
      tenancy_id IS NULL
      OR tenancy_id IN (
        SELECT id
        FROM tenancies
        WHERE organisation_id = get_my_org_id()
      )
    )
  );
