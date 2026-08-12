-- Store the readable name alongside the drawn signature image.
ALTER TABLE contract_signatures
  ADD COLUMN IF NOT EXISTS tenant_signature_name text;

