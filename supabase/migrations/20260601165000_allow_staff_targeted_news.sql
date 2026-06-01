UPDATE news n
SET organisation_id = p.organisation_id
FROM profiles p
WHERE n.created_by = p.id
  AND n.organisation_id IS NULL
  AND p.organisation_id IS NOT NULL;

DROP POLICY IF EXISTS "Authenticated users can read published news" ON news;
DROP POLICY IF EXISTS "Admin can insert news" ON news;
DROP POLICY IF EXISTS "Admin can update news" ON news;
DROP POLICY IF EXISTS "Org users can read targeted news" ON news;
DROP POLICY IF EXISTS "Org staff can insert news" ON news;
DROP POLICY IF EXISTS "Org staff can update news" ON news;
DROP POLICY IF EXISTS "Org staff can delete news" ON news;

CREATE POLICY "Org users can read targeted news"
  ON news FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      organisation_id = get_my_org_id()
      AND (
        get_my_role() = ANY (ARRAY['staff', 'admin'])
        OR (
          status = 'published'
          AND (
            target_type = 'all'
            OR (
              target_type = 'property'
              AND target_id IN (
                SELECT t.property_id
                FROM tenancies t
                WHERE t.tenant_id = auth.uid()
                  AND t.status = 'active'
              )
            )
          )
        )
      )
    )
  );

CREATE POLICY "Org staff can insert news"
  ON news FOR INSERT
  TO authenticated
  WITH CHECK (
    target_type IN ('all', 'property')
    AND created_by = auth.uid()
    AND (
      get_my_role() = 'superadmin'
      OR (
        get_my_role() = ANY (ARRAY['staff', 'admin'])
        AND organisation_id = get_my_org_id()
      )
    )
  );

CREATE POLICY "Org staff can update news"
  ON news FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = ANY (ARRAY['staff', 'admin'])
      AND organisation_id = get_my_org_id()
    )
  )
  WITH CHECK (
    target_type IN ('all', 'property')
    AND (
      get_my_role() = 'superadmin'
      OR (
        get_my_role() = ANY (ARRAY['staff', 'admin'])
        AND organisation_id = get_my_org_id()
      )
    )
  );

CREATE POLICY "Org staff can delete news"
  ON news FOR DELETE
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = ANY (ARRAY['staff', 'admin'])
      AND organisation_id = get_my_org_id()
    )
  );
