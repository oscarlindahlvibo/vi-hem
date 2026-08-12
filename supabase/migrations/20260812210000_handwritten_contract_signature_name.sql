-- Store the readable name alongside the drawn signature image.
-- VI-HEM tables use the vihem_ namespace in the shared Supabase schema.
ALTER TABLE public.vihem_contract_signatures
  ADD COLUMN IF NOT EXISTS tenant_signature_name text;
