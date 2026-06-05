DROP POLICY IF EXISTS "Admins can create org absence requests" ON staff_absence_requests;

CREATE POLICY "Admins can create org absence requests"
  ON staff_absence_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  );
