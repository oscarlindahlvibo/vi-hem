UPDATE time_entries te
SET organisation_id = p.organisation_id
FROM profiles p
WHERE te.user_id = p.id
  AND te.organisation_id IS NULL
  AND p.organisation_id IS NOT NULL;

DROP POLICY IF EXISTS "Staff can update own or admin all time entries" ON time_entries;

CREATE POLICY "Staff can update own or admin all time entries"
  ON time_entries FOR UPDATE
  TO authenticated
  USING (
    (
      user_id = auth.uid()
      AND (organisation_id IS NULL OR organisation_id = get_my_org_id())
    )
    OR (
      organisation_id = get_my_org_id()
      AND get_my_role() = 'admin'
    )
  )
  WITH CHECK (
    (
      user_id = auth.uid()
      AND (organisation_id IS NULL OR organisation_id = get_my_org_id())
    )
    OR (
      organisation_id = get_my_org_id()
      AND get_my_role() = 'admin'
    )
  );
