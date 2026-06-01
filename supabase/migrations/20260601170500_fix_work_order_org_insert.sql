UPDATE work_orders wo
SET organisation_id = p.organisation_id
FROM profiles p
WHERE wo.created_by = p.id
  AND wo.organisation_id IS NULL
  AND p.organisation_id IS NOT NULL;

DROP POLICY IF EXISTS "Org staff can read own org work orders" ON work_orders;
DROP POLICY IF EXISTS "Org staff can insert own org work orders" ON work_orders;
DROP POLICY IF EXISTS "Org staff can update own org work orders" ON work_orders;

CREATE POLICY "Org staff can read own org work orders"
  ON work_orders FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      organisation_id = get_my_org_id()
      AND get_my_role() = ANY (ARRAY['staff', 'admin'])
    )
  );

CREATE POLICY "Org staff can insert own org work orders"
  ON work_orders FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      organisation_id = get_my_org_id()
      AND get_my_role() = ANY (ARRAY['staff', 'admin'])
    )
  );

CREATE POLICY "Org staff can update own org work orders"
  ON work_orders FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      organisation_id = get_my_org_id()
      AND get_my_role() = ANY (ARRAY['staff', 'admin'])
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      organisation_id = get_my_org_id()
      AND get_my_role() = ANY (ARRAY['staff', 'admin'])
    )
  );
