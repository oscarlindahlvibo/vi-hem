ALTER TABLE time_entries
  DROP CONSTRAINT IF EXISTS time_entries_status_check;

ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_status_check
  CHECK (status IN ('draft','submitted','change_requested','approved','rejected'));

CREATE TABLE IF NOT EXISTS staff_absence_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  absence_type text NOT NULL CHECK (absence_type IN ('sick','vab','vacation','leave')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  comment text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected','cancelled')),
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_absence_requests_org ON staff_absence_requests(organisation_id);
CREATE INDEX IF NOT EXISTS idx_staff_absence_requests_user ON staff_absence_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_absence_requests_dates ON staff_absence_requests(start_date, end_date);

ALTER TABLE staff_absence_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read own absence requests" ON staff_absence_requests;
DROP POLICY IF EXISTS "Staff can create own absence requests" ON staff_absence_requests;
DROP POLICY IF EXISTS "Staff can update own pending absence requests" ON staff_absence_requests;
DROP POLICY IF EXISTS "Admins can read org absence requests" ON staff_absence_requests;
DROP POLICY IF EXISTS "Admins can update org absence requests" ON staff_absence_requests;

CREATE POLICY "Staff can read own absence requests"
  ON staff_absence_requests FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND (organisation_id IS NULL OR organisation_id = get_my_org_id())
  );

CREATE POLICY "Staff can create own absence requests"
  ON staff_absence_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (organisation_id IS NULL OR organisation_id = get_my_org_id())
  );

CREATE POLICY "Staff can update own pending absence requests"
  ON staff_absence_requests FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND status = 'submitted'
    AND (organisation_id IS NULL OR organisation_id = get_my_org_id())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND status IN ('submitted', 'cancelled')
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND (organisation_id IS NULL OR organisation_id = get_my_org_id())
  );

CREATE POLICY "Admins can read org absence requests"
  ON staff_absence_requests FOR SELECT
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  );

CREATE POLICY "Admins can update org absence requests"
  ON staff_absence_requests FOR UPDATE
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  )
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
  );
