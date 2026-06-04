ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS assigned_to_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]';

ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS assigned_to_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]';

UPDATE work_orders
SET assigned_to_ids = ARRAY[assigned_to]
WHERE assigned_to IS NOT NULL
  AND (assigned_to_ids IS NULL OR array_length(assigned_to_ids, 1) IS NULL);

UPDATE maintenance_requests
SET assigned_to_ids = ARRAY[assigned_to]
WHERE assigned_to IS NOT NULL
  AND (assigned_to_ids IS NULL OR array_length(assigned_to_ids, 1) IS NULL);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'work-order-attachments',
  'work-order-attachments',
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
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Staff can upload work order attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'work-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

CREATE POLICY "Staff can update work order attachments"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'work-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );

CREATE POLICY "Public can view work order attachments"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'work-order-attachments');

CREATE POLICY "Staff can delete work order attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'work-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('staff', 'admin', 'superadmin')
    )
  );
