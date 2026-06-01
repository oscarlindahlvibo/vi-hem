/*
  # Create superadmin demo user
*/

INSERT INTO auth.users (
  id, instance_id, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  aud, role, created_at, updated_at
)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'superadmin@demo.se',
  crypt('Superadmin1234!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Superadmin"}',
  'authenticated', 'authenticated', now(), now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
VALUES (
  'superadmin@demo.se',
  'aaaaaaaa-0000-0000-0000-000000000001',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","email":"superadmin@demo.se"}',
  'email', now(), now(), now()
)
ON CONFLICT (provider, provider_id) DO NOTHING;

INSERT INTO profiles (id, name, email, phone, role, active, organisation_id, auth_method)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Superadmin', 'superadmin@demo.se', '',
  'superadmin', true,
  '00000000-0000-0000-0000-000000000001',
  'password'
)
ON CONFLICT (id) DO UPDATE SET role = 'superadmin';
