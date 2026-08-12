INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vihem-inventory-images', 'vihem-inventory-images', true, 10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "VIHEM inventory images upload" ON storage.objects;
CREATE POLICY "VIHEM inventory images upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vihem-inventory-images'
    AND split_part(name, '/', 1) = public.vihem_get_my_org_id()::text
  );

DROP POLICY IF EXISTS "VIHEM inventory images update" ON storage.objects;
CREATE POLICY "VIHEM inventory images update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'vihem-inventory-images'
    AND split_part(name, '/', 1) = public.vihem_get_my_org_id()::text
  );

DROP POLICY IF EXISTS "VIHEM inventory images read" ON storage.objects;
CREATE POLICY "VIHEM inventory images read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'vihem-inventory-images');

DROP POLICY IF EXISTS "VIHEM inventory images delete" ON storage.objects;
CREATE POLICY "VIHEM inventory images delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'vihem-inventory-images'
    AND split_part(name, '/', 1) = public.vihem_get_my_org_id()::text
  );
