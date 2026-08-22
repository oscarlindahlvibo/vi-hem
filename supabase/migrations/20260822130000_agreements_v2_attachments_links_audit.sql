/*
  # Avtal V2 (BETA) — attachments, entity links, audit trail

  vihem_agreement_entity_links is the generic connection table required by
  the spec: an agreement may optionally link to any number of VI-HEM
  entities (apartment, property, tenancy, tenant, finance customer,
  customer project, supplier, ...) but NONE of those links is ever
  required -- a fully standalone agreement simply has zero rows here.
  Deliberately NOT a "tenant_id/apartment_id" pair of columns on
  vihem_agreements itself.

  vihem_agreement_audit_events is the single canonical event log covering
  BOTH the delivery mechanics (section 10 of the brief: created, sent,
  delivery failed, opened) AND the broader audit trail (section 14:
  who/when/how, plus technical proof fields). Kept as one table rather than
  two (delivery_events + audit_events) deliberately -- the two concepts
  overlap heavily (a "sent via SMS" delivery event IS an audit event), and
  splitting them would mean two RLS policies and two write paths for what
  is, in practice, one append-only timeline per agreement. Can be split
  later if delivery-specific querying/volume ever demands it.
*/

CREATE TABLE IF NOT EXISTS public.vihem_agreement_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.vihem_agreements(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  storage_bucket text NOT NULL DEFAULT 'vihem-agreements',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/pdf',
  file_size bigint NOT NULL DEFAULT 0,
  -- sha256 hex of the file bytes, computed at upload time. When the
  -- agreement is sent for signing, the CURRENT set of attachment ids+hashes
  -- is captured into that version's blocks/metadata (see
  -- _shared/agreement-snapshot.ts) so "what was actually in the signing
  -- package" is provable even if this row is later changed or the
  -- attachment removed from a subsequent, unsent draft state.
  content_hash text NOT NULL DEFAULT '',
  included_in_version_id uuid REFERENCES public.vihem_agreement_versions(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_agreement_attachments_agreement_idx
  ON public.vihem_agreement_attachments (agreement_id, position);

CREATE TABLE IF NOT EXISTS public.vihem_agreement_entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.vihem_agreements(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  label text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS vihem_agreement_entity_links_agreement_idx
  ON public.vihem_agreement_entity_links (agreement_id);
-- Reverse lookup: "show agreements linked to this apartment/tenancy" (used
-- by the apartment/tenant page integration).
CREATE INDEX IF NOT EXISTS vihem_agreement_entity_links_entity_idx
  ON public.vihem_agreement_entity_links (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.vihem_agreement_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.vihem_agreements(id) ON DELETE CASCADE,
  signer_id uuid REFERENCES public.vihem_agreement_signers(id) ON DELETE SET NULL,
  -- Open-ended text, not a CHECK enum: this is an append-only log whose
  -- vocabulary will keep growing (created, updated, sent_email, sent_sms,
  -- delivery_failed, viewed, signed, declined, reminder_sent, completed,
  -- cancelled, version_created, ...) and a CHECK would need a migration
  -- for every new event type on what is otherwise a low-risk text field.
  event_type text NOT NULL,
  actor_type text NOT NULL DEFAULT 'system' CHECK (actor_type IN ('staff', 'signer', 'system')),
  actor_id uuid,
  agreement_version_id uuid REFERENCES public.vihem_agreement_versions(id) ON DELETE SET NULL,
  document_hash text,
  channel text CHECK (channel IS NULL OR channel IN ('email', 'sms')),
  ip_address inet,
  user_agent text NOT NULL DEFAULT '',
  -- Small extra context (masked recipient, provider external_id, error
  -- message, BankID order ref, ...). Deliberately not the whole payload of
  -- anything -- "expose no more personal data than necessary in ordinary UI
  -- views" per the spec.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_agreement_audit_events_agreement_idx
  ON public.vihem_agreement_audit_events (agreement_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS.
--
-- Attachments: staff+admin org read/write while the parent agreement is
-- still draft/ready (matches the spec: add/remove/reorder only before
-- sending); read-only for staff once sent (can still view what was
-- attached, just can't add/remove -- INSERT/DELETE WITH CHECK below
-- enforces the status gate, SELECT has no such gate so history stays
-- visible after sending).
--
-- Entity links: staff+admin org read/write.
--
-- Audit events: staff+admin org read, PLUS a signer's own read of events on
-- their own agreement (so a tenant can see "you signed on <date>" in their
-- portal) -- but never insert/update/delete from any authenticated role;
-- every event is written by a service-role edge function, since a client
-- writing its own audit trail would defeat the point of an audit trail.
-- ---------------------------------------------------------------------------

ALTER TABLE public.vihem_agreement_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_agreement_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_agreement_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM agreement attachments staff read" ON public.vihem_agreement_attachments;
CREATE POLICY "VIHEM agreement attachments staff read"
  ON public.vihem_agreement_attachments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_attachments.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement attachments staff insert" ON public.vihem_agreement_attachments;
CREATE POLICY "VIHEM agreement attachments staff insert"
  ON public.vihem_agreement_attachments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_attachments.agreement_id
        AND a.status IN ('draft', 'ready')
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement attachments staff delete" ON public.vihem_agreement_attachments;
CREATE POLICY "VIHEM agreement attachments staff delete"
  ON public.vihem_agreement_attachments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_attachments.agreement_id
        AND a.status IN ('draft', 'ready')
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement attachments staff update metadata" ON public.vihem_agreement_attachments;
CREATE POLICY "VIHEM agreement attachments staff update metadata"
  ON public.vihem_agreement_attachments FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_attachments.agreement_id
        AND a.status IN ('draft', 'ready')
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_attachments.agreement_id
        AND a.status IN ('draft', 'ready')
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement entity links staff access" ON public.vihem_agreement_entity_links;
CREATE POLICY "VIHEM agreement entity links staff access"
  ON public.vihem_agreement_entity_links FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_entity_links.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_entity_links.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement audit events staff read" ON public.vihem_agreement_audit_events;
CREATE POLICY "VIHEM agreement audit events staff read"
  ON public.vihem_agreement_audit_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreements a
      WHERE a.id = vihem_agreement_audit_events.agreement_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND a.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement audit events self read" ON public.vihem_agreement_audit_events;
CREATE POLICY "VIHEM agreement audit events self read"
  ON public.vihem_agreement_audit_events FOR SELECT TO authenticated
  USING (
    signer_id IN (
      SELECT s.id FROM public.vihem_agreement_signers s WHERE s.profile_id = auth.uid()
    )
  );
