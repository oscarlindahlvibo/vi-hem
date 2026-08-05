/*
  # VI-HEM news audience targeting

  Adds role-based audience targeting to news while keeping property targeting.
*/

ALTER TABLE vihem_news
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'tenants',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'news_target_type_check'
      AND conrelid = 'vihem_news'::regclass
  ) THEN
    ALTER TABLE vihem_news DROP CONSTRAINT news_target_type_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vihem_news_target_type_check'
      AND conrelid = 'vihem_news'::regclass
  ) THEN
    ALTER TABLE vihem_news
      ADD CONSTRAINT vihem_news_target_type_check
      CHECK (target_type IN ('all','property','staircase','tenant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vihem_news_audience_check'
      AND conrelid = 'vihem_news'::regclass
  ) THEN
    ALTER TABLE vihem_news
      ADD CONSTRAINT vihem_news_audience_check
      CHECK (audience IN ('tenants','staff','all'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vihem_news_priority_check'
      AND conrelid = 'vihem_news'::regclass
  ) THEN
    ALTER TABLE vihem_news
      ADD CONSTRAINT vihem_news_priority_check
      CHECK (priority IN ('normal','important','urgent'));
  END IF;
END $$;

DROP POLICY IF EXISTS "Org users can read targeted news" ON vihem_news;
DROP POLICY IF EXISTS "Org staff can insert news" ON vihem_news;
DROP POLICY IF EXISTS "Org staff can update news" ON vihem_news;
DROP POLICY IF EXISTS "Org staff can delete news" ON vihem_news;
DROP POLICY IF EXISTS "VIHEM users can read targeted news" ON vihem_news;
DROP POLICY IF EXISTS "VIHEM staff can insert news" ON vihem_news;
DROP POLICY IF EXISTS "VIHEM staff can update news" ON vihem_news;
DROP POLICY IF EXISTS "VIHEM staff can delete news" ON vihem_news;

CREATE POLICY "VIHEM users can read targeted news"
  ON vihem_news FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      organisation_id = get_my_org_id()
      AND (
        get_my_role() = ANY (ARRAY['staff', 'admin'])
        OR (
          status = 'published'
          AND audience IN ('tenants', 'all')
          AND (
            target_type = 'all'
            OR (
              target_type = 'property'
              AND target_id IN (
                SELECT t.property_id
                FROM vihem_tenancies t
                WHERE t.tenant_id = auth.uid()
                  AND t.status = 'active'
              )
            )
            OR (
              target_type = 'tenant'
              AND target_id = auth.uid()
            )
          )
        )
      )
    )
  );

CREATE POLICY "VIHEM staff can insert news"
  ON vihem_news FOR INSERT
  TO authenticated
  WITH CHECK (
    target_type IN ('all', 'property', 'tenant')
    AND audience IN ('tenants', 'staff', 'all')
    AND created_by = auth.uid()
    AND (
      get_my_role() = 'superadmin'
      OR (
        get_my_role() = ANY (ARRAY['staff', 'admin'])
        AND organisation_id = get_my_org_id()
      )
    )
  );

CREATE POLICY "VIHEM staff can update news"
  ON vihem_news FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = ANY (ARRAY['staff', 'admin'])
      AND organisation_id = get_my_org_id()
    )
  )
  WITH CHECK (
    target_type IN ('all', 'property', 'tenant')
    AND audience IN ('tenants', 'staff', 'all')
    AND (
      get_my_role() = 'superadmin'
      OR (
        get_my_role() = ANY (ARRAY['staff', 'admin'])
        AND organisation_id = get_my_org_id()
      )
    )
  );

CREATE POLICY "VIHEM staff can delete news"
  ON vihem_news FOR DELETE
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = ANY (ARRAY['staff', 'admin'])
      AND organisation_id = get_my_org_id()
    )
  );
