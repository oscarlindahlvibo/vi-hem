CREATE OR REPLACE FUNCTION can_access_chat_thread(thread_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_threads ct
    WHERE ct.id = thread_uuid
      AND (
        ct.created_by = auth.uid()
        OR get_my_role() = 'superadmin'
        OR (
          get_my_role() IN ('staff', 'admin')
          AND ct.organisation_id = get_my_org_id()
        )
        OR ct.tenant_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM chat_participants cp
          WHERE cp.thread_id = ct.id
            AND cp.user_id = auth.uid()
        )
      )
  );
$$;
