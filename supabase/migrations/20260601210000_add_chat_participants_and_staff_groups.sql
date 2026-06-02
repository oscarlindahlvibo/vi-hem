ALTER TABLE chat_threads
  ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS chat_type text NOT NULL DEFAULT 'tenant_support'
    CHECK (chat_type IN ('tenant_support', 'direct', 'group')),
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id);

UPDATE chat_threads
SET created_by = tenant_id
WHERE created_by IS NULL AND tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(thread_id, user_id)
);

INSERT INTO chat_participants (thread_id, user_id)
SELECT id, tenant_id
FROM chat_threads
WHERE tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO chat_participants (thread_id, user_id)
SELECT id, assigned_to
FROM chat_threads
WHERE assigned_to IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;

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
        get_my_role() = 'superadmin'
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

DROP POLICY IF EXISTS "Tenant can read own chat threads" ON chat_threads;
DROP POLICY IF EXISTS "Tenant can insert chat threads" ON chat_threads;
DROP POLICY IF EXISTS "Staff can read all chat threads" ON chat_threads;
DROP POLICY IF EXISTS "Staff can update chat threads" ON chat_threads;
DROP POLICY IF EXISTS "Org users can read own org chat threads" ON chat_threads;
DROP POLICY IF EXISTS "Users can read permitted chat threads" ON chat_threads;
DROP POLICY IF EXISTS "Users can insert permitted chat threads" ON chat_threads;
DROP POLICY IF EXISTS "Users can update permitted chat threads" ON chat_threads;

CREATE POLICY "Users can read permitted chat threads"
  ON chat_threads FOR SELECT
  TO authenticated
  USING (can_access_chat_thread(id));

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
          OR tenant_id IN (
            SELECT id
            FROM profiles
            WHERE role = 'tenant'
              AND organisation_id = get_my_org_id()
          )
        )
      )
    )
  );

CREATE POLICY "Users can update permitted chat threads"
  ON chat_threads FOR UPDATE
  TO authenticated
  USING (can_access_chat_thread(id))
  WITH CHECK (can_access_chat_thread(id));

DROP POLICY IF EXISTS "Tenant can read messages in own threads" ON chat_messages;
DROP POLICY IF EXISTS "Tenant can insert messages in own threads" ON chat_messages;
DROP POLICY IF EXISTS "Staff can read all messages" ON chat_messages;
DROP POLICY IF EXISTS "Staff can insert messages" ON chat_messages;
DROP POLICY IF EXISTS "Staff can update messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can read permitted chat messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert permitted chat messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can update permitted chat messages" ON chat_messages;

CREATE POLICY "Users can read permitted chat messages"
  ON chat_messages FOR SELECT
  TO authenticated
  USING (can_access_chat_thread(thread_id));

CREATE POLICY "Users can insert permitted chat messages"
  ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND can_access_chat_thread(thread_id)
    AND EXISTS (
      SELECT 1 FROM chat_threads
      WHERE id = thread_id
        AND status = 'open'
    )
  );

CREATE POLICY "Users can update permitted chat messages"
  ON chat_messages FOR UPDATE
  TO authenticated
  USING (can_access_chat_thread(thread_id))
  WITH CHECK (can_access_chat_thread(thread_id));

DROP POLICY IF EXISTS "Users can read permitted chat participants" ON chat_participants;
DROP POLICY IF EXISTS "Users can insert permitted chat participants" ON chat_participants;
DROP POLICY IF EXISTS "Users can update permitted chat participants" ON chat_participants;

CREATE POLICY "Users can read permitted chat participants"
  ON chat_participants FOR SELECT
  TO authenticated
  USING (can_access_chat_thread(thread_id));

CREATE POLICY "Users can insert permitted chat participants"
  ON chat_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    can_access_chat_thread(thread_id)
    AND (
      user_id = auth.uid()
      OR get_my_role() IN ('staff', 'admin', 'superadmin')
    )
    AND user_id IN (
      SELECT id
      FROM profiles
      WHERE organisation_id = get_my_org_id()
    )
  );

CREATE POLICY "Users can update permitted chat participants"
  ON chat_participants FOR UPDATE
  TO authenticated
  USING (can_access_chat_thread(thread_id))
  WITH CHECK (can_access_chat_thread(thread_id));

CREATE INDEX IF NOT EXISTS idx_chat_threads_org_type ON chat_threads(organisation_id, chat_type);
CREATE INDEX IF NOT EXISTS idx_chat_participants_thread ON chat_participants(thread_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
