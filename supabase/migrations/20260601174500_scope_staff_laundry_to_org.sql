DROP POLICY IF EXISTS "Users can read permitted laundry rooms" ON laundry_rooms;
DROP POLICY IF EXISTS "Users can read permitted laundry slots" ON laundry_slots;
DROP POLICY IF EXISTS "Users can read permitted laundry bookings" ON laundry_bookings;
DROP POLICY IF EXISTS "Users can insert permitted laundry bookings" ON laundry_bookings;
DROP POLICY IF EXISTS "Users can update permitted laundry bookings" ON laundry_bookings;
DROP POLICY IF EXISTS "Org users can read laundry rooms" ON laundry_rooms;
DROP POLICY IF EXISTS "Org users can read laundry slots" ON laundry_slots;
DROP POLICY IF EXISTS "Org users can read relevant laundry bookings" ON laundry_bookings;
DROP POLICY IF EXISTS "Org users can insert relevant laundry bookings" ON laundry_bookings;
DROP POLICY IF EXISTS "Org users can update own laundry bookings" ON laundry_bookings;

CREATE POLICY "Org users can read laundry rooms"
  ON laundry_rooms FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      organisation_id = get_my_org_id()
      AND get_my_role() = ANY (ARRAY['staff', 'admin'])
    )
    OR property_id IN (
      SELECT t.property_id
      FROM tenancies t
      WHERE t.tenant_id = auth.uid()
        AND t.status = 'active'
    )
  );

CREATE POLICY "Org users can read laundry slots"
  ON laundry_slots FOR SELECT
  TO authenticated
  USING (
    laundry_room_id IN (
      SELECT lr.id
      FROM laundry_rooms lr
      WHERE
        get_my_role() = 'superadmin'
        OR (
          lr.organisation_id = get_my_org_id()
          AND get_my_role() = ANY (ARRAY['staff', 'admin'])
        )
        OR lr.property_id IN (
          SELECT t.property_id
          FROM tenancies t
          WHERE t.tenant_id = auth.uid()
            AND t.status = 'active'
        )
    )
  );

CREATE POLICY "Org users can read relevant laundry bookings"
  ON laundry_bookings FOR SELECT
  TO authenticated
  USING (
    tenant_id = auth.uid()
    OR laundry_slot_id IN (
      SELECT ls.id
      FROM laundry_slots ls
      JOIN laundry_rooms lr ON lr.id = ls.laundry_room_id
      WHERE
        get_my_role() = 'superadmin'
        OR (
          lr.organisation_id = get_my_org_id()
          AND get_my_role() = ANY (ARRAY['staff', 'admin'])
        )
        OR lr.property_id IN (
          SELECT t.property_id
          FROM tenancies t
          WHERE t.tenant_id = auth.uid()
            AND t.status = 'active'
        )
    )
  );

CREATE POLICY "Org users can insert relevant laundry bookings"
  ON laundry_bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = auth.uid()
    AND laundry_slot_id IN (
      SELECT ls.id
      FROM laundry_slots ls
      JOIN laundry_rooms lr ON lr.id = ls.laundry_room_id
      WHERE
        get_my_role() = 'superadmin'
        OR (
          lr.organisation_id = get_my_org_id()
          AND get_my_role() = ANY (ARRAY['staff', 'admin'])
        )
        OR lr.property_id IN (
          SELECT t.property_id
          FROM tenancies t
          WHERE t.tenant_id = auth.uid()
            AND t.status = 'active'
        )
    )
  );

CREATE POLICY "Org users can update own laundry bookings"
  ON laundry_bookings FOR UPDATE
  TO authenticated
  USING (
    tenant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM laundry_slots ls
      JOIN laundry_rooms lr ON lr.id = ls.laundry_room_id
      WHERE ls.id = laundry_bookings.laundry_slot_id
        AND (
          get_my_role() = 'superadmin'
          OR (
            lr.organisation_id = get_my_org_id()
            AND get_my_role() = ANY (ARRAY['staff', 'admin'])
          )
        )
    )
  )
  WITH CHECK (
    tenant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM laundry_slots ls
      JOIN laundry_rooms lr ON lr.id = ls.laundry_room_id
      WHERE ls.id = laundry_bookings.laundry_slot_id
        AND (
          get_my_role() = 'superadmin'
          OR (
            lr.organisation_id = get_my_org_id()
            AND get_my_role() = ANY (ARRAY['staff', 'admin'])
          )
        )
    )
  );
