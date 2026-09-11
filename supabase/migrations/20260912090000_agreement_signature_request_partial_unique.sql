-- vihem_agreement_signature_requests had a plain UNIQUE(signer_id,
-- agreement_version_id) constraint, but the "send"/"remind"/
-- "get_my_signing_link" code paths in vihem-agreements-workflow all follow a
-- revoke-then-reissue pattern (a stored token_hash can never be turned back
-- into the raw token, so a fresh one is always minted). Revoking only sets
-- revoked_at -- it never deletes the row -- so the very first request for a
-- signer+version already "used up" that unique slot forever, and every
-- later attempt (a reminder, a signer reopening their portal link, or the
-- workflow retrying a send) hit
-- "duplicate key value violates unique constraint
-- vihem_agreement_signature_req_signer_id_agreement_version_i_key" instead
-- of creating the new request.
--
-- Replace it with a partial unique index so only ACTIVE (non-revoked)
-- requests are constrained to one per signer+version -- matching what the
-- code actually intends ("one valid link per signer at a time") -- while
-- revoked history rows can coexist freely.
ALTER TABLE public.vihem_agreement_signature_requests
  DROP CONSTRAINT IF EXISTS vihem_agreement_signature_req_signer_id_agreement_version_i_key;

DROP INDEX IF EXISTS public.vihem_agreement_signature_requests_active_signer_version_idx;
CREATE UNIQUE INDEX vihem_agreement_signature_requests_active_signer_version_idx
  ON public.vihem_agreement_signature_requests (signer_id, agreement_version_id)
  WHERE revoked_at IS NULL;
