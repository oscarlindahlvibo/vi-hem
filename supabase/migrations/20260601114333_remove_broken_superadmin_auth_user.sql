/*
  # Remove broken superadmin auth user so it can be recreated via admin API
*/
-- Kept as a no-op for local development: the preceding migration creates a
-- working superadmin auth user that lets the app be tested without requiring
-- the setup-demo-users Edge Function to recreate it.
