/*
  # Avtal V2 (BETA): fix missing tenant self-read on vihem_agreements

  20260822120000 added a signer's own read of their own
  vihem_agreement_signers / vihem_agreement_versions / vihem_agreement_
  signatures / vihem_agreement_audit_events rows, but missed the parent
  vihem_agreements row itself -- a signer could see their own signature
  and status, but not the agreement's own title/document_number/status,
  making a tenant-facing "my agreements" view impossible.

  A naive fix (a raw EXISTS subquery into vihem_agreement_signers, like the
  other self-read policies use) causes INFINITE RECURSION: evaluating that
  subquery re-triggers vihem_agreement_signers' OWN "staff access" policy,
  which reads vihem_agreements again to check org access, which
  re-evaluates vihem_agreements' policies (including this one) again.
  Caught by actually running this against a local Postgres instance (see
  docs/agreements-v2.md "Verifiering") -- Postgres raised "infinite
  recursion detected in policy for relation vihem_agreements" immediately
  on a real query.

  Fixed with a SECURITY DEFINER helper, same pattern as
  vihem_user_has_company_access / vihem_get_my_role elsewhere in this
  codebase: the function's internal query runs as its owner (the
  table-owning role), which bypasses RLS entirely on tables without FORCE
  ROW LEVEL SECURITY (true for every table in this migration set) -- so it
  never re-triggers vihem_agreement_signers' policies, breaking the cycle
  at its source rather than needing every OTHER self-read policy that also
  touches vihem_agreement_signers to be rewritten too.
*/

CREATE OR REPLACE FUNCTION public.vihem_agreement_ids_for_signer_profile(p_profile_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT agreement_id FROM public.vihem_agreement_signers WHERE profile_id = p_profile_id;
$$;

COMMENT ON FUNCTION public.vihem_agreement_ids_for_signer_profile IS
  'RLS-recursion-safe lookup of which agreements a profile is a signer on. SECURITY DEFINER bypasses RLS on vihem_agreement_signers internally -- required to avoid the vihem_agreements <-> vihem_agreement_signers policy cycle documented in this migration''s header.';

DROP POLICY IF EXISTS "VIHEM agreements signer self read" ON public.vihem_agreements;
CREATE POLICY "VIHEM agreements signer self read"
  ON public.vihem_agreements FOR SELECT TO authenticated
  USING (id IN (SELECT public.vihem_agreement_ids_for_signer_profile(auth.uid())));
