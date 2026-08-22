/*
  # Avtal V2 (BETA) — core: agreements, draft blocks, immutable versions

  vihem_agreements is the root row (a "document": agreement | offer | other).
  It has NO tenant_id/apartment_id/customer_id columns -- optional links to
  VI-HEM entities are a separate generic table
  (vihem_agreement_entity_links, next migration), so a fully standalone
  agreement between two parties neither of which exists elsewhere in VI-HEM
  is first-class, not a workaround.

  Two-layer content model:
    - vihem_agreement_blocks: the MUTABLE current draft. Freely editable
      while status is 'draft'/'ready'. This is what the block editor reads
      and writes.
    - vihem_agreement_versions: IMMUTABLE snapshots. Created exactly once
      per "send for signing" action (see vihem-agreements-workflow), never
      updated after insert. Each version freezes the fully-resolved block
      content (dynamic fields like {{tenant.name}} already substituted with
      their value at that moment) plus a content_hash, so a later change to
      the underlying tenant/apartment record can NEVER alter what a signer
      actually saw and signed. If an agreement needs to change after being
      sent, that requires a NEW version (version_number + 1) -- signatures
      always reference the exact version_id they were made against, so old
      signatures never silently "count" for a new version.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE EXTENSION pg_trgm;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.vihem_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  document_number text NOT NULL,
  document_type text NOT NULL DEFAULT 'agreement' CHECK (document_type IN ('agreement', 'offer', 'other')),
  category text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  template_id uuid REFERENCES public.vihem_agreement_templates(id) ON DELETE SET NULL,
  -- One status column covers both agreements and offers deliberately (see
  -- spec: "utan en djungel av specialfall") -- accepted/rejected are only
  -- ever set on document_type='offer' rows, enforced in application code
  -- (an edge function), not a CHECK constraint, since expressing a
  -- conditional-per-column CHECK cleanly in Postgres adds more complexity
  -- than the one invalid-combination it would prevent is worth.
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'ready', 'sent', 'viewed', 'partially_signed', 'signed',
    'declined', 'expired', 'cancelled', 'archived', 'accepted', 'rejected'
  )),
  current_version_id uuid,
  valid_until date,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  UNIQUE (organisation_id, document_number)
);

CREATE INDEX IF NOT EXISTS vihem_agreements_org_status_idx
  ON public.vihem_agreements (organisation_id, status);
CREATE INDEX IF NOT EXISTS vihem_agreements_org_type_idx
  ON public.vihem_agreements (organisation_id, document_type);
-- Fast free-text-ish search on title/document_number from the archive page.
CREATE INDEX IF NOT EXISTS vihem_agreements_title_trgm_idx
  ON public.vihem_agreements USING gin (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.vihem_agreement_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.vihem_agreements(id) ON DELETE CASCADE,
  position integer NOT NULL,
  block_type text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_agreement_blocks_agreement_idx
  ON public.vihem_agreement_blocks (agreement_id, position);

CREATE TABLE IF NOT EXISTS public.vihem_agreement_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.vihem_agreements(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  -- Fully resolved block array at freeze time: [{id, type, content}, ...].
  -- Each dynamic_field block's resolved value is baked in here alongside
  -- its original {{token}} (for display/audit), so this row alone is
  -- sufficient to reconstruct exactly what was sent/signed even if every
  -- other table in this migration were empty.
  blocks jsonb NOT NULL,
  -- sha256 hex of the canonical (stable key order, no whitespace) JSON
  -- serialisation of `blocks` -- see _shared/agreement-snapshot.ts. Lets an
  -- auditor verify "this PDF/version matches what was actually signed"
  -- without trusting the row wasn't edited (it can't be: no UPDATE policy
  -- exists on this table for any role, see RLS below).
  content_hash text NOT NULL,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  frozen_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  UNIQUE (agreement_id, version_number)
);

CREATE INDEX IF NOT EXISTS vihem_agreement_versions_agreement_idx
  ON public.vihem_agreement_versions (agreement_id, version_number DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.vihem_agreements'::regclass
      AND conname = 'vihem_agreements_current_version_fkey'
  ) THEN
    ALTER TABLE public.vihem_agreements
      ADD CONSTRAINT vihem_agreements_current_version_fkey
      FOREIGN KEY (current_version_id) REFERENCES public.vihem_agreement_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_agreements',
    'vihem_agreement_blocks'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER vihem_touch_updated_at_trigger BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()',
      table_name
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- RLS.
--
-- vihem_agreements / vihem_agreement_blocks: staff+admin org-scoped
-- read/write, same shape as vihem_documents. NOT tenant-readable here --
-- a tenant's access to "their" agreements is granted narrowly in the next
-- migration (via vihem_agreement_signers.profile_id = auth.uid()), matching
-- the explicit requirement that a tenant must never see the organisation's
-- whole agreement archive, only documents addressed to them specifically.
--
-- vihem_agreement_versions: readable under the same staff/admin scope PLUS
-- a signer's own read (added in the signers migration, since it needs to
-- join through vihem_agreement_signers). Critically: NO UPDATE policy and
-- NO DELETE policy for any authenticated role, on purpose -- once a version
-- exists it is permanently immutable from the client's perspective. Only
-- service-role (the edge function that freezes it) can ever write it, via
-- INSERT.
-- ---------------------------------------------------------------------------

ALTER TABLE public.vihem_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_agreement_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_agreement_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM agreements staff read" ON public.vihem_agreements;
CREATE POLICY "VIHEM agreements staff read"
  ON public.vihem_agreements FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (public.vihem_get_my_role() IN ('staff', 'admin') AND organisation_id = public.vihem_get_my_org_id())
  );

DROP POLICY IF EXISTS "VIHEM agreements staff insert" ON public.vihem_agreements;
CREATE POLICY "VIHEM agreements staff insert"
  ON public.vihem_agreements FOR INSERT TO authenticated
  WITH CHECK (
    public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin')
    AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id())
  );

DROP POLICY IF EXISTS "VIHEM agreements staff update" ON public.vihem_agreements;
CREATE POLICY "VIHEM agreements staff update"
  ON public.vihem_agreements FOR UPDATE TO authenticated
  USING (
    public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin')
    AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id())
  )
  WITH CHECK (
    public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin')
    AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id())
  );

DROP POLICY IF EXISTS "VIHEM agreements admin delete draft" ON public.vihem_agreements;
CREATE POLICY "VIHEM agreements admin delete draft"
  ON public.vihem_agreements FOR DELETE TO authenticated
  USING (
    status = 'draft'
    AND public.vihem_get_my_role() IN ('admin', 'superadmin')
    AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id())
  );

DROP POLICY IF EXISTS "VIHEM agreement blocks staff access" ON public.vihem_agreement_blocks;
CREATE POLICY "VIHEM agreement blocks staff access"
  ON public.vihem_agreement_blocks FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_blocks.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_blocks.agreement_id
        AND a.status IN ('draft', 'ready')
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement versions staff read" ON public.vihem_agreement_versions;
CREATE POLICY "VIHEM agreement versions staff read"
  ON public.vihem_agreement_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_versions.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

-- Deliberately no INSERT/UPDATE/DELETE policy for `authenticated` on
-- vihem_agreement_versions: only the service-role edge function
-- (vihem-agreements-workflow) may ever write a version row.
