/*
  # Avtal V2 (BETA) — storage bucket

  A dedicated PRIVATE bucket for agreement attachments and generated
  final/signed PDFs -- never public, matching the explicit requirement that
  agreement files must not be publicly reachable. A separate bucket from
  vihem-documents (rather than reusing it) because the RLS shape genuinely
  differs: an agreement's files must also be reachable by an EXTERNAL
  signer who has no Supabase session at all (via the public signing edge
  function, which uses the service-role client and issues short-lived
  signed URLs itself) -- something vihem-documents' storage.objects policies
  were never designed for. Internal staff/admin access follows the exact
  same createSignedUrl()-from-the-frontend pattern vihem-documents already
  uses (see DocumentsPage.tsx), just against this bucket.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vihem-agreements',
  'vihem-agreements',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Objects are stored under `${organisation_id}/${agreement_id}/...` so the
-- org-scope check below is a single, cheap prefix comparison rather than a
-- join. Every upload path used by the edge functions/frontend MUST follow
-- this convention.

DROP POLICY IF EXISTS "VIHEM agreements staff read files" ON storage.objects;
CREATE POLICY "VIHEM agreements staff read files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'vihem-agreements'
    AND (
      public.vihem_get_my_role() = 'superadmin'
      OR (
        public.vihem_get_my_role() IN ('staff', 'admin')
        AND (storage.foldername(name))[1] = public.vihem_get_my_org_id()::text
      )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreements staff upload files" ON storage.objects;
CREATE POLICY "VIHEM agreements staff upload files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vihem-agreements'
    AND (
      public.vihem_get_my_role() = 'superadmin'
      OR (
        public.vihem_get_my_role() IN ('staff', 'admin')
        AND (storage.foldername(name))[1] = public.vihem_get_my_org_id()::text
      )
    )
  );

DROP POLICY IF EXISTS "VIHEM agreements staff delete files" ON storage.objects;
CREATE POLICY "VIHEM agreements staff delete files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'vihem-agreements'
    AND (
      public.vihem_get_my_role() = 'superadmin'
      OR (
        public.vihem_get_my_role() IN ('staff', 'admin')
        AND (storage.foldername(name))[1] = public.vihem_get_my_org_id()::text
      )
    )
  );

-- No policy at all for the `anon` role: an external signer never gets
-- direct storage access, only whatever the public signing edge function
-- explicitly hands back (a short-lived signed URL generated server-side
-- with the service-role client, which bypasses these policies entirely).
