/*
  # Scanner -> Accounted forwarding

  VI-HEM's scanner UI stays (legacy, in FinancePage.tsx, untouched). This
  adds a NEW, separate path in Finance V2: forward a scanned document
  (supplier invoice / receipt photo or PDF) to Accounted's invoice-inbox
  extension via its documented email channel, instead of running VI-HEM's
  own OCR/AI pipeline (vihem-process-supplier-invoice-ocr) on it. Accounted
  does the AI extraction from there (it already has direct Anthropic API
  support in self-hosted installs) -- see docs/accounted-v2-integration.md
  "Scanner -> Accounted" for why the email channel was chosen over a direct
  API call (invoice-inbox's manual upload route requires a browser session
  cookie, not an API-key Bearer, so it isn't usable server-to-server).

  No core Accounted change and no new storage bucket: uploads reuse the
  existing vihem-documents bucket, same as the legacy supplier-invoice
  scanner's own uploads.
*/

CREATE TABLE IF NOT EXISTS public.vihem_accounted_scanner_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_link_id uuid NOT NULL REFERENCES public.vihem_accounted_company_links(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'vihem-documents',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/pdf',
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'failed')),
  error_message text NOT NULL DEFAULT '',
  sent_at timestamptz,
  uploaded_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_accounted_scanner_uploads_company_link_idx
  ON public.vihem_accounted_scanner_uploads (company_link_id, created_at DESC);

ALTER TABLE public.vihem_accounted_scanner_uploads ENABLE ROW LEVEL SECURITY;

-- Same pattern as the other link/read-model tables: company-scoped read,
-- no direct client writes (the row is created by vihem-accounted-scanner-
-- forward together with the actual send attempt, so "a row exists" always
-- corresponds to a real forwarding attempt, never a client-fabricated one).
DROP POLICY IF EXISTS "VIHEM accounted scanner uploads read" ON public.vihem_accounted_scanner_uploads;
CREATE POLICY "VIHEM accounted scanner uploads read"
  ON public.vihem_accounted_scanner_uploads FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND EXISTS (
      SELECT 1 FROM public.vihem_accounted_company_links l
      WHERE l.id = vihem_accounted_scanner_uploads.company_link_id AND public.vihem_user_has_company_access(l.company_id, 'viewer')
    ))
  );

DROP POLICY IF EXISTS "VIHEM accounted scanner uploads no client writes" ON public.vihem_accounted_scanner_uploads;
CREATE POLICY "VIHEM accounted scanner uploads no client writes"
  ON public.vihem_accounted_scanner_uploads FOR ALL TO authenticated USING (false) WITH CHECK (false);
