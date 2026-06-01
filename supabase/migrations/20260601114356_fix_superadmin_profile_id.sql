/*
  # Ensure superadmin profile exists
*/
INSERT INTO profiles (id, name, email, phone, role, active, organisation_id, auth_method)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Superadmin',
  'superadmin@demo.se',
  '',
  'superadmin',
  true,
  '00000000-0000-0000-0000-000000000001',
  'password'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  active = EXCLUDED.active,
  organisation_id = EXCLUDED.organisation_id,
  auth_method = EXCLUDED.auth_method,
  updated_at = now();
