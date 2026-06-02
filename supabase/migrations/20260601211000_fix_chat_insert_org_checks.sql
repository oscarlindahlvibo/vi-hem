CREATE OR REPLACE FUNCTION is_user_in_my_org(user_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = user_uuid
      AND organisation_id = get_my_org_id()
  );
$$;

DROP POLICY IF EXISTS "Users can insert permitted chat threads" ON chat_threads;

CREATE POLICY "Users can insert permitted chat threads"
  ON chat_threads FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND organisation_id = get_my_org_id()
    AND (
      (
        get_my_role() = 'tenant'
        AND chat_type = 'tenant_support'
        AND tenant_id = auth.uid()
      )
      OR (
        get_my_role() IN ('staff', 'admin', 'superadmin')
        AND (
          tenant_id IS NULL
          OR is_user_in_my_org(tenant_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can insert permitted chat participants" ON chat_participants;

CREATE POLICY "Users can insert permitted chat participants"
  ON chat_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    can_access_chat_thread(thread_id)
    AND (
      user_id = auth.uid()
      OR get_my_role() IN ('staff', 'admin', 'superadmin')
    )
    AND is_user_in_my_org(user_id)
  );
