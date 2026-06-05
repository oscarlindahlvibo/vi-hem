DROP POLICY IF EXISTS "Admins can insert org time entries" ON time_entries;
DROP POLICY IF EXISTS "Admins can delete org time entries" ON time_entries;

CREATE POLICY "Admins can insert org time entries"
  ON time_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  );

CREATE POLICY "Admins can delete org time entries"
  ON time_entries FOR DELETE
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  );
