DROP POLICY IF EXISTS "Chat creators can read own threads" ON chat_threads;

CREATE POLICY "Chat creators can read own threads"
  ON chat_threads FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());
