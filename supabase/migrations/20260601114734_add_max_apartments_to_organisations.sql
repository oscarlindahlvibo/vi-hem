/*
  # Add apartment quota to organisations

  Adds max_apartments column to organisations so superadmin can cap
  how many apartments each customer org is allowed to create.

  ## Changes
  - `organisations.max_apartments` (integer, default 10) — max apartments allowed per org
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organisations' AND column_name = 'max_apartments'
  ) THEN
    ALTER TABLE organisations ADD COLUMN max_apartments integer NOT NULL DEFAULT 10;
  END IF;
END $$;

-- Give the demo org a generous default
UPDATE organisations
SET max_apartments = 100
WHERE id = '00000000-0000-0000-0000-000000000001';
