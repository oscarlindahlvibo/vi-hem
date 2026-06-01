/*
  # BankID Support

  Adds the necessary fields to support Swedish BankID for authentication and
  contract signing in the future.

  ## Changes

  ### profiles table
  - `bankid_personal_number` (text, nullable) — Swedish 12-digit personal number
    linked after first successful BankID authentication
  - `bankid_linked_at` (timestamptz, nullable) — when BankID was first linked
  - `auth_method` (text, default 'password') — 'password' | 'bankid' | 'both'

  ### contract_signatures table
  New columns to support BankID-verified signatures alongside the existing
  plain-text name signature:
  - `tenant_bankid_personal_number` (text, nullable) — personal number used to sign
  - `tenant_bankid_signature` (text, nullable) — BankID signature token/reference
  - `tenant_bankid_signed_at` (timestamptz, nullable) — BankID signing timestamp
  - `tenant_signature_method` (text, default 'name') — 'name' | 'bankid'
  - `staff_bankid_personal_number` (text, nullable)
  - `staff_bankid_signature` (text, nullable)
  - `staff_bankid_signed_at` (timestamptz, nullable)
  - `staff_signature_method` (text, default 'name') — 'name' | 'bankid'

  ## Security
  - No RLS changes required; existing policies already cover new columns
  - personal_number is sensitive PII — stored only when user explicitly links BankID
*/

-- Add BankID fields to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'bankid_personal_number'
  ) THEN
    ALTER TABLE profiles ADD COLUMN bankid_personal_number text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'bankid_linked_at'
  ) THEN
    ALTER TABLE profiles ADD COLUMN bankid_linked_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'auth_method'
  ) THEN
    ALTER TABLE profiles ADD COLUMN auth_method text NOT NULL DEFAULT 'password';
  END IF;
END $$;

-- Add BankID signature fields to contract_signatures
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_signatures' AND column_name = 'tenant_bankid_personal_number'
  ) THEN
    ALTER TABLE contract_signatures ADD COLUMN tenant_bankid_personal_number text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_signatures' AND column_name = 'tenant_bankid_signature'
  ) THEN
    ALTER TABLE contract_signatures ADD COLUMN tenant_bankid_signature text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_signatures' AND column_name = 'tenant_bankid_signed_at'
  ) THEN
    ALTER TABLE contract_signatures ADD COLUMN tenant_bankid_signed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_signatures' AND column_name = 'tenant_signature_method'
  ) THEN
    ALTER TABLE contract_signatures ADD COLUMN tenant_signature_method text NOT NULL DEFAULT 'name';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_signatures' AND column_name = 'staff_bankid_personal_number'
  ) THEN
    ALTER TABLE contract_signatures ADD COLUMN staff_bankid_personal_number text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_signatures' AND column_name = 'staff_bankid_signature'
  ) THEN
    ALTER TABLE contract_signatures ADD COLUMN staff_bankid_signature text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_signatures' AND column_name = 'staff_bankid_signed_at'
  ) THEN
    ALTER TABLE contract_signatures ADD COLUMN staff_bankid_signed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_signatures' AND column_name = 'staff_signature_method'
  ) THEN
    ALTER TABLE contract_signatures ADD COLUMN staff_signature_method text NOT NULL DEFAULT 'name';
  END IF;
END $$;
