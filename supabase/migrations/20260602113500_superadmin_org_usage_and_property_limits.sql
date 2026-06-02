ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS max_properties integer NOT NULL DEFAULT 10;

UPDATE organisations
SET max_properties = CASE
  WHEN plan = 'trial' THEN 3
  WHEN plan = 'starter' THEN 10
  WHEN plan = 'professional' THEN 50
  WHEN plan = 'enterprise' THEN 250
  ELSE max_properties
END
WHERE max_properties IS NULL OR max_properties = 10;

DROP POLICY IF EXISTS "Superadmin can read all profiles" ON profiles;
CREATE POLICY "Superadmin can read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (get_my_role() = 'superadmin');

DROP POLICY IF EXISTS "Superadmin can read all properties" ON properties;
CREATE POLICY "Superadmin can read all properties"
  ON properties FOR SELECT
  TO authenticated
  USING (get_my_role() = 'superadmin');

DROP POLICY IF EXISTS "Superadmin can read all apartments" ON apartments;
CREATE POLICY "Superadmin can read all apartments"
  ON apartments FOR SELECT
  TO authenticated
  USING (get_my_role() = 'superadmin');

DROP POLICY IF EXISTS "Superadmin can read all organisations" ON organisations;
CREATE POLICY "Superadmin can read all organisations"
  ON organisations FOR SELECT
  TO authenticated
  USING (get_my_role() = 'superadmin');
