/*
  # Remove broken superadmin auth user so it can be recreated via admin API
*/
DELETE FROM auth.identities WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
DELETE FROM auth.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Keep the profile row — setup-demo-users will upsert it with the new auth user id
