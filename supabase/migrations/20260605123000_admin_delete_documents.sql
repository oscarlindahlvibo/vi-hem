DROP POLICY IF EXISTS "Admin can delete documents" ON documents;

CREATE POLICY "Admin can delete documents"
  ON documents FOR DELETE
  TO authenticated
  USING (
    get_my_role() IN ('admin', 'superadmin')
    AND (
      organisation_id = get_my_org_id()
      OR organisation_id IS NULL
    )
  );
