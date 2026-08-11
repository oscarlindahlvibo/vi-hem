ALTER TABLE public.vihem_rental_assets
  ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vihem-rental-images',
  'vihem-rental-images',
  true,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic'];

DROP POLICY IF EXISTS "Rental images public read" ON storage.objects;
CREATE POLICY "Rental images public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'vihem-rental-images');

DROP POLICY IF EXISTS "Rental images staff upload" ON storage.objects;
CREATE POLICY "Rental images staff upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vihem-rental-images' AND (storage.foldername(name))[1] = public.get_my_org_id()::text AND public.get_my_role() = ANY(ARRAY['staff','admin']));

DROP POLICY IF EXISTS "Rental images staff update" ON storage.objects;
CREATE POLICY "Rental images staff update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'vihem-rental-images' AND (storage.foldername(name))[1] = public.get_my_org_id()::text AND public.get_my_role() = ANY(ARRAY['staff','admin']))
  WITH CHECK (bucket_id = 'vihem-rental-images' AND (storage.foldername(name))[1] = public.get_my_org_id()::text AND public.get_my_role() = ANY(ARRAY['staff','admin']));

DROP POLICY IF EXISTS "Rental images staff delete" ON storage.objects;
CREATE POLICY "Rental images staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'vihem-rental-images' AND (storage.foldername(name))[1] = public.get_my_org_id()::text AND public.get_my_role() = ANY(ARRAY['staff','admin']));

NOTIFY pgrst, 'reload schema';
