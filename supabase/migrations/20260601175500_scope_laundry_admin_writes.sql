DROP POLICY IF EXISTS "Admin can insert laundry rooms" ON laundry_rooms;
DROP POLICY IF EXISTS "Admin can update laundry rooms" ON laundry_rooms;
DROP POLICY IF EXISTS "Admin can insert laundry slots" ON laundry_slots;
DROP POLICY IF EXISTS "Admin can update laundry slots" ON laundry_slots;

CREATE POLICY "Admin can insert own org laundry rooms"
  ON laundry_rooms FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND organisation_id = get_my_org_id()
      AND property_id IN (
        SELECT id FROM properties WHERE organisation_id = get_my_org_id()
      )
    )
  );

CREATE POLICY "Admin can update own org laundry rooms"
  ON laundry_rooms FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND organisation_id = get_my_org_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND organisation_id = get_my_org_id()
      AND property_id IN (
        SELECT id FROM properties WHERE organisation_id = get_my_org_id()
      )
    )
  );

CREATE POLICY "Admin can insert own org laundry slots"
  ON laundry_slots FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND laundry_room_id IN (
        SELECT id FROM laundry_rooms WHERE organisation_id = get_my_org_id()
      )
    )
  );

CREATE POLICY "Admin can update own org laundry slots"
  ON laundry_slots FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND laundry_room_id IN (
        SELECT id FROM laundry_rooms WHERE organisation_id = get_my_org_id()
      )
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND laundry_room_id IN (
        SELECT id FROM laundry_rooms WHERE organisation_id = get_my_org_id()
      )
    )
  );
