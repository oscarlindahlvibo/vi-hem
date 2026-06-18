/*
  # Safe VI-HEM shared resource namespace migration

  Replaces the production use of 20260616090000, which must be skipped in
  shared production because an earlier version attempted direct deletes from
  Supabase storage tables. This migration is intentionally append-only for
  storage data and only creates/updates VI-HEM-prefixed resources.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vihem-inspection-photos',
  'vihem-inspection-photos',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vihem-work-order-attachments',
  'vihem-work-order-attachments',
  true,
  15728640,
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "VIHEM staff can upload inspection photos" ON storage.objects;
CREATE POLICY "VIHEM staff can upload inspection photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'vihem-inspection-photos'
    AND EXISTS (
      SELECT 1 FROM public.vihem_profiles
      WHERE vihem_profiles.id = auth.uid()
        AND vihem_profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS "VIHEM staff can update inspection photos" ON storage.objects;
CREATE POLICY "VIHEM staff can update inspection photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'vihem-inspection-photos'
    AND EXISTS (
      SELECT 1 FROM public.vihem_profiles
      WHERE vihem_profiles.id = auth.uid()
        AND vihem_profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS "VIHEM public can view inspection photos" ON storage.objects;
CREATE POLICY "VIHEM public can view inspection photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'vihem-inspection-photos');

DROP POLICY IF EXISTS "VIHEM staff can delete inspection photos" ON storage.objects;
CREATE POLICY "VIHEM staff can delete inspection photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'vihem-inspection-photos'
    AND EXISTS (
      SELECT 1 FROM public.vihem_profiles
      WHERE vihem_profiles.id = auth.uid()
        AND vihem_profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS "VIHEM staff can upload work order attachments" ON storage.objects;
CREATE POLICY "VIHEM staff can upload work order attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'vihem-work-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.vihem_profiles
      WHERE vihem_profiles.id = auth.uid()
        AND vihem_profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS "VIHEM staff can update work order attachments" ON storage.objects;
CREATE POLICY "VIHEM staff can update work order attachments"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'vihem-work-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.vihem_profiles
      WHERE vihem_profiles.id = auth.uid()
        AND vihem_profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS "VIHEM public can view work order attachments" ON storage.objects;
CREATE POLICY "VIHEM public can view work order attachments"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'vihem-work-order-attachments');

DROP POLICY IF EXISTS "VIHEM staff can delete work order attachments" ON storage.objects;
CREATE POLICY "VIHEM staff can delete work order attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'vihem-work-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.vihem_profiles
      WHERE vihem_profiles.id = auth.uid()
        AND vihem_profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

NOTIFY pgrst, 'reload schema';
