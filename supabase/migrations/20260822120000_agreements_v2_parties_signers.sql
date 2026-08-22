/*
  # Avtal V2 (BETA) — parties, signers, signature requests, signatures

  Parties (who the document is BETWEEN, e.g. "Vibogruppen AB" / "Anna
  Andersson") are modelled separately from signers (WHO must physically
  sign, e.g. "Kidde signs for Vibogruppen AB"), matching the spec: a party
  can be internal, a known VI-HEM contact/customer, a company, or a fully
  manual entry -- never a hard requirement to already exist as a tenant or
  customer record.

  A signature request is the secure, single-purpose link sent to one
  signer. A signature is the resulting evidence, always pinned to the exact
  agreement_version_id that was shown to the signer -- see
  20260822110000_agreements_v2_core.sql's header for why that pin matters.
*/

CREATE TABLE IF NOT EXISTS public.vihem_agreement_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.vihem_agreements(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('internal_org', 'contact', 'company', 'manual')),
  display_name text NOT NULL,
  org_number text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  -- Generic pointer to an existing VI-HEM record this party represents
  -- (e.g. source_type='tenant', source_id=<vihem_profiles.id>), same
  -- source_type/source_id vocabulary used across the codebase (Accounted V2
  -- customer links, etc.). Null for a fully manual/standalone party -- this
  -- is what makes "Anna Andersson" not need to already be a VI-HEM tenant.
  source_type text,
  source_id uuid,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_agreement_parties_agreement_idx
  ON public.vihem_agreement_parties (agreement_id, position);

CREATE TABLE IF NOT EXISTS public.vihem_agreement_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.vihem_agreements(id) ON DELETE CASCADE,
  party_id uuid REFERENCES public.vihem_agreement_parties(id) ON DELETE SET NULL,
  -- Set only when this signer IS a logged-in VI-HEM user (typically a
  -- tenant) -- lets that person see the agreement in their own portal via
  -- the RLS policy below, in ADDITION to the external signing-link flow.
  -- Never required: a signer can be a name/email/phone with no VI-HEM
  -- account at all.
  profile_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  personal_number text NOT NULL DEFAULT '',
  role_title text NOT NULL DEFAULT '',
  signing_method text NOT NULL DEFAULT 'handwritten' CHECK (signing_method IN ('handwritten', 'bankid')),
  signing_required boolean NOT NULL DEFAULT true,
  -- Null = parallel (any order). A number = this signer's position in a
  -- sequential chain. Etapp 1 only ENFORCES parallel signing (see
  -- vihem-agreements-workflow) -- sign_order is stored from day one so
  -- sequential enforcement can be added later without a schema change, per
  -- the spec's explicit "prepare the data model, start with parallel".
  sign_order integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'viewed', 'signed', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_agreement_signers_agreement_idx
  ON public.vihem_agreement_signers (agreement_id);
CREATE INDEX IF NOT EXISTS vihem_agreement_signers_profile_idx
  ON public.vihem_agreement_signers (profile_id) WHERE profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vihem_agreement_signature_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.vihem_agreements(id) ON DELETE CASCADE,
  signer_id uuid NOT NULL REFERENCES public.vihem_agreement_signers(id) ON DELETE CASCADE,
  agreement_version_id uuid NOT NULL REFERENCES public.vihem_agreement_versions(id) ON DELETE CASCADE,
  -- The raw token is NEVER stored -- only its sha256 hash, so a database
  -- read (backup, replica, compromised query log) can never yield a usable
  -- signing link. The edge function that creates a request generates the
  -- raw token, returns/sends it once, and only ever persists this hash;
  -- verifying an incoming token means hashing it and looking up by hash.
  -- (This is stricter than the existing vihem_laundry_guest_links
  -- convention, which stores its token in plaintext -- a deliberate
  -- deviation given legal signatures are higher-stakes than a laundry
  -- booking link; see docs/agreements-v2.md.)
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signer_id, agreement_version_id)
);

CREATE INDEX IF NOT EXISTS vihem_agreement_signature_requests_agreement_idx
  ON public.vihem_agreement_signature_requests (agreement_id);

CREATE TABLE IF NOT EXISTS public.vihem_agreement_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.vihem_agreements(id) ON DELETE CASCADE,
  signer_id uuid NOT NULL REFERENCES public.vihem_agreement_signers(id) ON DELETE CASCADE,
  signature_request_id uuid NOT NULL REFERENCES public.vihem_agreement_signature_requests(id) ON DELETE RESTRICT,
  -- Exactly which frozen version was shown to and signed by this signer.
  agreement_version_id uuid NOT NULL REFERENCES public.vihem_agreement_versions(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('handwritten', 'bankid')),
  signature_image text,
  signature_name text NOT NULL DEFAULT '',
  bankid_personal_number text,
  bankid_reference text,
  -- Proof/audit info beyond "a PNG and a boolean", per the explicit
  -- requirement: the request context at the moment of signing.
  ip_address inet,
  user_agent text NOT NULL DEFAULT '',
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signer_id, agreement_version_id)
);

CREATE INDEX IF NOT EXISTS vihem_agreement_signatures_agreement_idx
  ON public.vihem_agreement_signatures (agreement_id);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_agreement_parties',
    'vihem_agreement_signers'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER vihem_touch_updated_at_trigger BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()',
      table_name
    );
  END LOOP;
END $$;

-- A tenant/signer reading their own agreement needs vihem_agreement_versions
-- readable too (they're shown the frozen content in-app, not just via the
-- external signing link) -- add that branch here since it needs to join
-- through vihem_agreement_signers, which didn't exist yet in the core
-- migration.
DROP POLICY IF EXISTS "VIHEM agreement versions signer read" ON public.vihem_agreement_versions;
CREATE POLICY "VIHEM agreement versions signer read"
  ON public.vihem_agreement_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreement_signers s
      WHERE s.agreement_id = vihem_agreement_versions.agreement_id
        AND s.profile_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- RLS.
--
-- Parties/signers: staff+admin org read/write (joined through the parent
-- agreement, same pattern as vihem_agreement_blocks), PLUS a signer's own
-- read of their own signer row (so a logged-in tenant can see their own
-- name/status without staff access).
--
-- Signature requests: NO client access at all, in either direction -- the
-- token hash must never be readable by any authenticated Supabase role, not
-- even the signer it belongs to (they authenticate via the raw token in the
-- URL against the PUBLIC edge function, which uses the service-role client;
-- they never get a Supabase session at all). Staff can't read the hash
-- either since it's not useful to them and every unnecessary exposure of it
-- is a small risk for zero benefit.
--
-- Signatures: staff+admin org read (it's evidence, immutable, useful to see
-- in the UI) plus the signer's own read of their own signature. No
-- INSERT/UPDATE/DELETE policy for `authenticated` at all -- only the public
-- signing edge function (service-role) ever writes a signature, and it is
-- never updated or deleted once written.
-- ---------------------------------------------------------------------------

ALTER TABLE public.vihem_agreement_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_agreement_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_agreement_signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_agreement_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM agreement parties staff access" ON public.vihem_agreement_parties;
CREATE POLICY "VIHEM agreement parties staff access"
  ON public.vihem_agreement_parties FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_parties.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_parties.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement signers staff access" ON public.vihem_agreement_signers;
CREATE POLICY "VIHEM agreement signers staff access"
  ON public.vihem_agreement_signers FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_signers.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_signers.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement signers self read" ON public.vihem_agreement_signers;
CREATE POLICY "VIHEM agreement signers self read"
  ON public.vihem_agreement_signers FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "VIHEM agreement signature requests no client access" ON public.vihem_agreement_signature_requests;
CREATE POLICY "VIHEM agreement signature requests no client access"
  ON public.vihem_agreement_signature_requests FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "VIHEM agreement signatures staff read" ON public.vihem_agreement_signatures;
CREATE POLICY "VIHEM agreement signatures staff read"
  ON public.vihem_agreement_signatures FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_signatures.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement signatures self read" ON public.vihem_agreement_signatures;
CREATE POLICY "VIHEM agreement signatures self read"
  ON public.vihem_agreement_signatures FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreement_signers s
      WHERE s.id = vihem_agreement_signatures.signer_id
        AND s.profile_id = auth.uid()
    )
  );
