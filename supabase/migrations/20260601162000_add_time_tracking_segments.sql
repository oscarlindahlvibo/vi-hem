ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'work'
    CHECK (entry_type IN ('work', 'break')),
  ADD COLUMN IF NOT EXISTS customer_name text;

CREATE TABLE IF NOT EXISTS daily_work_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  comment text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, work_date)
);

ALTER TABLE daily_work_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own daily work summaries" ON daily_work_summaries;
DROP POLICY IF EXISTS "Users can insert own daily work summaries" ON daily_work_summaries;
DROP POLICY IF EXISTS "Users can update own daily work summaries" ON daily_work_summaries;
DROP POLICY IF EXISTS "Admins can read daily work summaries" ON daily_work_summaries;

CREATE POLICY "Users can read own daily work summaries"
  ON daily_work_summaries FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own daily work summaries"
  ON daily_work_summaries FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own daily work summaries"
  ON daily_work_summaries FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can read daily work summaries"
  ON daily_work_summaries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'superadmin')
    )
  );

CREATE INDEX IF NOT EXISTS idx_daily_work_summaries_user_date
  ON daily_work_summaries(user_id, work_date);
