/*
  # Fix superadmin profile to match new auth user id
*/
-- Remove old profile with wrong id
DELETE FROM profiles WHERE email = 'superadmin@demo.se' AND id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Ensure the new profile has correct role and org (upsert by email lookup)
UPDATE profiles
SET role = 'superadmin',
    active = true,
    organisation_id = '00000000-0000-0000-0000-000000000001'
WHERE email = 'superadmin@demo.se';
