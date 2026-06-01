/*
  # Organisations (Multi-tenant SaaS foundation) — Part B
  Adds organisation_id FK to all business tables, assigns existing data
  to the demo org, and tightens the organisations RLS policy.
*/

-- ── profiles ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='organisation_id') THEN
    ALTER TABLE profiles ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── properties ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='properties' AND column_name='organisation_id') THEN
    ALTER TABLE properties ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── apartments ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartments' AND column_name='organisation_id') THEN
    ALTER TABLE apartments ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── tenancies ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenancies' AND column_name='organisation_id') THEN
    ALTER TABLE tenancies ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── maintenance_requests ───────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='maintenance_requests' AND column_name='organisation_id') THEN
    ALTER TABLE maintenance_requests ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── work_orders ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_orders' AND column_name='organisation_id') THEN
    ALTER TABLE work_orders ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── time_entries ───────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='time_entries' AND column_name='organisation_id') THEN
    ALTER TABLE time_entries ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── laundry_rooms ──────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='laundry_rooms' AND column_name='organisation_id') THEN
    ALTER TABLE laundry_rooms ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── documents ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='organisation_id') THEN
    ALTER TABLE documents ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── news ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='news' AND column_name='organisation_id') THEN
    ALTER TABLE news ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── chat_threads ───────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_threads' AND column_name='organisation_id') THEN
    ALTER TABLE chat_threads ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── notifications ──────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='organisation_id') THEN
    ALTER TABLE notifications ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── termination_requests ───────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='termination_requests' AND column_name='organisation_id') THEN
    ALTER TABLE termination_requests ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── apartment_inspections ──────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='apartment_inspections' AND column_name='organisation_id') THEN
    ALTER TABLE apartment_inspections ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── contract_signatures ────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contract_signatures' AND column_name='organisation_id') THEN
    ALTER TABLE contract_signatures ADD COLUMN organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Assign existing data to demo org ───────────────────────────────────────
UPDATE profiles           SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE properties         SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE apartments         SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE tenancies          SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE maintenance_requests SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE work_orders        SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE time_entries       SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE laundry_rooms      SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE documents          SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE news               SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE chat_threads       SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE notifications      SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE termination_requests SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE apartment_inspections SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;
UPDATE contract_signatures SET organisation_id = '00000000-0000-0000-0000-000000000001' WHERE organisation_id IS NULL;

-- ── Tighten organisations RLS ──────────────────────────────────────────────
-- Replace the open read policy with a membership-scoped one
DROP POLICY IF EXISTS "Authenticated users can read organisations" ON organisations;

CREATE POLICY "Members can read own organisation"
  ON organisations FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT organisation_id FROM profiles
      WHERE id = auth.uid() AND organisation_id IS NOT NULL
    )
  );
