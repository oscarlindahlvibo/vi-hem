/*
  # Create storage bucket for inspection photos

  Creates a public storage bucket 'inspection-photos' for storing
  apartment inspection photos uploaded by staff.

  - Bucket is public (photos can be viewed via public URL)
  - Only authenticated staff/admin/superadmin can upload
  - Anyone with the URL can view (for tenant access to their own inspection)
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-photos',
  'inspection-photos',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Allow staff/admin/superadmin to upload photos
CREATE POLICY "Staff can upload inspection photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

-- Allow staff to update/replace photos
CREATE POLICY "Staff can update inspection photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'inspection-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

-- Public read access (photos are public URLs referenced from the inspection)
CREATE POLICY "Public can view inspection photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'inspection-photos');

-- Staff can delete photos
CREATE POLICY "Staff can delete inspection photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'inspection-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );
