CREATE OR REPLACE FUNCTION prevent_multiple_tenants_in_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_user_role text;
BEGIN
  SELECT role INTO new_user_role
  FROM profiles
  WHERE id = NEW.user_id;

  IF new_user_role = 'tenant' AND EXISTS (
    SELECT 1
    FROM chat_participants cp
    JOIN profiles p ON p.id = cp.user_id
    WHERE cp.thread_id = NEW.thread_id
      AND cp.user_id <> NEW.user_id
      AND p.role = 'tenant'
  ) THEN
    RAISE EXCEPTION 'Hyresgäster kan inte delta i samma chatt med andra hyresgäster';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_multiple_tenants_in_chat_trigger ON chat_participants;

CREATE TRIGGER prevent_multiple_tenants_in_chat_trigger
  BEFORE INSERT OR UPDATE OF user_id, thread_id ON chat_participants
  FOR EACH ROW
  EXECUTE FUNCTION prevent_multiple_tenants_in_chat();
