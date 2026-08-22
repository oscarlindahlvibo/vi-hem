/*
  # Avtal V2 (BETA): final signed PDF

  Once every required signer has signed, a final combined PDF (content +
  signatures + BankID verification info/link where applicable) is
  generated server-side and stored -- this is a distinct artifact from the
  per-agreement Bilagor uploaded before sending (vihem_agreement_
  attachments), so it gets its own two columns on vihem_agreements rather
  than being shoehorned into that table.
*/

ALTER TABLE public.vihem_agreements
  ADD COLUMN IF NOT EXISTS final_pdf_storage_path text,
  ADD COLUMN IF NOT EXISTS final_pdf_generated_at timestamptz;

-- Every signed document gets a short, unguessable verification code,
-- generated once at signing completion -- embedded (alongside the
-- document number) in the QR/link printed on the final PDF, and required
-- by vihem-agreements-verify (public) to look up a document. Deliberately
-- NOT the document_number alone: that's sequential and guessable, and
-- letting anyone enumerate AVT-2026-00001, 00002, ... to pull up any
-- organisation's signature summary would be a real information leak, even
-- though the verify endpoint itself is intentionally low-sensitivity
-- (status/signer names/method only, never full document content).
ALTER TABLE public.vihem_agreements
  ADD COLUMN IF NOT EXISTS verification_code text;

CREATE UNIQUE INDEX IF NOT EXISTS vihem_agreements_verification_code_idx
  ON public.vihem_agreements (verification_code)
  WHERE verification_code IS NOT NULL;
