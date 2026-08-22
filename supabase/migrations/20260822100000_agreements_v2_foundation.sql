/*
  # Avtal V2 (BETA) — foundation: document numbering + templates

  A brand new, general-purpose agreement/quote engine. Lives entirely
  alongside the existing legacy contract feature (vihem_contract_signatures,
  InspectionsPage.tsx/ApartmentPage.tsx) -- nothing here touches, reads, or
  writes any legacy table. Legacy keeps working unchanged; V2 is additive.

  Design principle (see docs/agreements-v2.md for the full write-up): the
  root concept is a generic "document" (agreement | offer | other), NOT a
  tenancy lease. Optional links to VI-HEM entities (apartment, tenancy,
  customer, ...) live in a separate generic link table
  (20260822130000_agreements_v2_attachments_links_audit.sql), never as
  required FK columns here -- a fully standalone agreement between two
  parties neither of which is a VI-HEM tenant must be representable.

  Scoped to organisation_id only (not company_id, unlike Finance V2) --
  legacy contracts and this domain have no "which legal entity issued this"
  concept the way invoicing does; every organisation gets Avtal V2 enabled
  from day one (no vihem_organisation_modules opt-in row), matching the
  explicit product requirement.
*/

-- ---------------------------------------------------------------------------
-- Document numbering: AVT-2026-00001 / OFF-2026-00001, one counter per
-- (organisation, document_type). Same atomic UPDATE/INSERT...RETURNING
-- pattern as vihem_next_invoice_number (20260809100000), which is what
-- makes it safe under concurrent callers -- the INSERT ... ON CONFLICT DO
-- UPDATE takes a row lock, so two simultaneous "create agreement" calls can
-- never receive the same number. Unlike the invoice series, this seeds
-- itself lazily (INSERT ... ON CONFLICT) instead of requiring a pre-created
-- row per organisation/company, so every org works from the first call
-- without an admin setup step.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vihem_agreement_number_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('agreement', 'offer', 'other')),
  fiscal_year integer NOT NULL,
  prefix text NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  padding integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, document_type, fiscal_year)
);

CREATE OR REPLACE FUNCTION public.vihem_next_agreement_number(
  p_organisation_id uuid,
  p_document_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM now())::integer;
  v_prefix text := CASE p_document_type WHEN 'offer' THEN 'OFF' ELSE 'AVT' END;
  v_number integer;
BEGIN
  -- next_number's stored meaning is "the number this row will hand out on
  -- its NEXT allocation" only ONCE it already exists; the very first
  -- allocation for a given (org, type, year) is satisfied by the INSERT
  -- itself (value 1), and RETURNING always reflects whichever branch fired
  -- (INSERT or the ON CONFLICT UPDATE) -- so a single RETURNING is correct
  -- for both the first-ever call and every call after it.
  INSERT INTO public.vihem_agreement_number_series (organisation_id, document_type, fiscal_year, prefix, next_number)
  VALUES (p_organisation_id, p_document_type, v_year, v_prefix, 1)
  ON CONFLICT (organisation_id, document_type, fiscal_year)
  DO UPDATE SET next_number = vihem_agreement_number_series.next_number + 1, updated_at = now()
  RETURNING next_number INTO v_number;

  RETURN v_prefix || '-' || v_year || '-' || lpad(v_number::text, 5, '0');
END;
$$;

COMMENT ON FUNCTION public.vihem_next_agreement_number IS
  'Atomically allocates the next AVT-/OFF-YYYY-NNNNN number for an organisation+document_type+year. Safe under concurrent calls (single-row UPSERT does the locking).';

-- ---------------------------------------------------------------------------
-- Templates: admin-authored starting points for new documents. A template's
-- blocks live in a SEPARATE table (vihem_agreement_template_blocks), not a
-- json blob, so block content stays queryable/relationally ordered the same
-- way agreement blocks are (see 20260822110000). Editing a template NEVER
-- touches agreements already created from it -- "create from template" only
-- COPIES the template's blocks into the new agreement's own block rows.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vihem_agreement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  document_type text NOT NULL DEFAULT 'agreement' CHECK (document_type IN ('agreement', 'offer', 'other')),
  category text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_agreement_templates_org_idx
  ON public.vihem_agreement_templates (organisation_id, status);

CREATE TABLE IF NOT EXISTS public.vihem_agreement_template_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.vihem_agreement_templates(id) ON DELETE CASCADE,
  position integer NOT NULL,
  block_type text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_agreement_template_blocks_template_idx
  ON public.vihem_agreement_template_blocks (template_id, position);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_agreement_number_series',
    'vihem_agreement_templates',
    'vihem_agreement_template_blocks'
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
-- RLS. Org-scoped, role-gated exactly like vihem_documents: staff+admin
-- (+superadmin) get full read/write within their own organisation; nothing
-- here is tenant-readable (tenants never see the template library or the
-- number-series internals -- those aren't user-facing documents).
-- vihem_agreement_number_series is service-role-only (no client access at
-- all): a client should never read/guess the next number, only receive it
-- back as part of a created agreement.
-- ---------------------------------------------------------------------------

ALTER TABLE public.vihem_agreement_number_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_agreement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_agreement_template_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM agreement number series no client access" ON public.vihem_agreement_number_series;
CREATE POLICY "VIHEM agreement number series no client access"
  ON public.vihem_agreement_number_series FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "VIHEM agreement templates staff read" ON public.vihem_agreement_templates;
CREATE POLICY "VIHEM agreement templates staff read"
  ON public.vihem_agreement_templates FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (public.vihem_get_my_role() IN ('staff', 'admin') AND organisation_id = public.vihem_get_my_org_id())
  );

DROP POLICY IF EXISTS "VIHEM agreement templates staff insert" ON public.vihem_agreement_templates;
CREATE POLICY "VIHEM agreement templates staff insert"
  ON public.vihem_agreement_templates FOR INSERT TO authenticated
  WITH CHECK (
    public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin')
    AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id())
  );

DROP POLICY IF EXISTS "VIHEM agreement templates staff update" ON public.vihem_agreement_templates;
CREATE POLICY "VIHEM agreement templates staff update"
  ON public.vihem_agreement_templates FOR UPDATE TO authenticated
  USING (
    public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin')
    AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id())
  )
  WITH CHECK (
    public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin')
    AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id())
  );

-- No client DELETE policy: templates are archived (status='archived'), never
-- deleted -- matches the "duplicate/edit/archive" lifecycle in the spec and
-- avoids ever breaking a FK from an agreement created off a deleted template.

DROP POLICY IF EXISTS "VIHEM agreement template blocks staff read" ON public.vihem_agreement_template_blocks;
CREATE POLICY "VIHEM agreement template blocks staff read"
  ON public.vihem_agreement_template_blocks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreement_templates t
      WHERE t.id = vihem_agreement_template_blocks.template_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND t.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreement template blocks staff write" ON public.vihem_agreement_template_blocks;
CREATE POLICY "VIHEM agreement template blocks staff write"
  ON public.vihem_agreement_template_blocks FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vihem_agreement_templates t
      WHERE t.id = vihem_agreement_template_blocks.template_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND t.organisation_id = public.vihem_get_my_org_id())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vihem_agreement_templates t
      WHERE t.id = vihem_agreement_template_blocks.template_id
        AND (
          public.vihem_get_my_role() = 'superadmin'
          OR (public.vihem_get_my_role() IN ('staff', 'admin') AND t.organisation_id = public.vihem_get_my_org_id())
        )
    )
  );
