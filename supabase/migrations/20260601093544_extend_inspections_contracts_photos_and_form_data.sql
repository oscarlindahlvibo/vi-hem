/*
  # Extend inspections and contracts with photo support and structured form data

  1. Modifications
    - `apartment_inspections`
      - Add `photo_urls` (jsonb array of strings) — URLs of photos attached to the inspection
    - `contract_signatures`
      - Add `contract_type` (text: apartment | premises) — whether it's a residential or commercial lease
      - Add `contract_data` (jsonb) — structured form data for the contract (checkboxes, fields etc.)
      - Drop old `contract_content` text column approach in favor of structured + generated text
        (keeping contract_content for the rendered/signed text snapshot)

  2. Notes
    - photo_urls stores Supabase Storage public URLs or external image URLs
    - contract_data stores all the structured checkbox/field values used to generate the contract text
    - contract_type defaults to 'apartment'
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'apartment_inspections' AND column_name = 'photo_urls'
  ) THEN
    ALTER TABLE apartment_inspections ADD COLUMN photo_urls jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_signatures' AND column_name = 'contract_type'
  ) THEN
    ALTER TABLE contract_signatures ADD COLUMN contract_type text NOT NULL DEFAULT 'apartment'
      CHECK (contract_type = ANY (ARRAY['apartment', 'premises']));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_signatures' AND column_name = 'contract_data'
  ) THEN
    ALTER TABLE contract_signatures ADD COLUMN contract_data jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;
