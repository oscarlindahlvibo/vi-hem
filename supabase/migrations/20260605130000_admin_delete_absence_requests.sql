DROP POLICY IF EXISTS "Admins can delete org absence requests" ON staff_absence_requests;

CREATE POLICY "Admins can delete org absence requests"
  ON staff_absence_requests FOR DELETE
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  );
