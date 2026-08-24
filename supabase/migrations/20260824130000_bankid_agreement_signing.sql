/*
  # BankID -- Avtal V2 signering (token-autentiserad, ingen VI-HEM-session)

  Låter en vihem_bankid_orders-rad med flow='sign' peka på antingen den
  BEFINTLIGA vihem_contract_signatures-vägen (contract_id, kräver en
  inloggad hyresgäst) ELLER en Avtal V2-signeringsförfrågan
  (agreement_signature_request_id, kräver ENDAST en giltig signeringstoken
  -- signataren har aldrig en VI-HEM-session). De två kolumnerna är
  ömsesidigt uteslutande per rad; vihem-bankid/index.ts grenar på vilken
  som är satt.

  ON DELETE SET NULL, inte CASCADE: en BankID-order är ett revisionsspår
  (completion_data, status) som ska överleva även om signeringsförfrågan
  själv någon gång städas bort -- samma resonemang som den befintliga
  contract_id-kolumnen redan följer.
*/

ALTER TABLE public.vihem_bankid_orders
  ADD COLUMN IF NOT EXISTS agreement_signature_request_id uuid REFERENCES public.vihem_agreement_signature_requests(id) ON DELETE SET NULL;
