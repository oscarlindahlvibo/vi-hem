/*
  # VI-HEM namespace for shared Supabase resources

  This app can share a Supabase instance with other apps. New shared resources
  should use the vihem_ / vihem-* namespace to avoid collisions.
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
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS "VIHEM staff can update inspection photos" ON storage.objects;
CREATE POLICY "VIHEM staff can update inspection photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'vihem-inspection-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'superadmin')
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
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS "VIHEM staff can upload work order attachments" ON storage.objects;
CREATE POLICY "VIHEM staff can upload work order attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'vihem-work-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS "VIHEM staff can update work order attachments" ON storage.objects;
CREATE POLICY "VIHEM staff can update work order attachments"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'vihem-work-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'superadmin')
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
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

-- Do not drop legacy storage.objects policies here.
-- Supabase Storage protects direct deletes in this environment, so the legacy
-- cleanup step can fail the whole migration even though the new VIHEM policies
-- above are the only ones that need to be created.

CREATE OR REPLACE FUNCTION public.vihem_get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), '');
$$;

CREATE OR REPLACE FUNCTION public.vihem_get_my_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT organisation_id FROM public.profiles WHERE id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.vihem_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.vihem_get_my_role() IN ('admin', 'superadmin');
$$;

CREATE OR REPLACE FUNCTION public.vihem_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin');
$$;

NOTIFY pgrst, 'reload schema';
