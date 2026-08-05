/*
  # VI-HEM document management

  Adds a dedicated documents storage bucket, categorisation metadata and
  namespace-safe policies for vihem_documents.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vihem-documents',
  'vihem-documents',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE vihem_documents
  ADD COLUMN IF NOT EXISTS document_category text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS contract_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_document_type_check'
      AND conrelid = 'vihem_documents'::regclass
  ) THEN
    ALTER TABLE vihem_documents DROP CONSTRAINT documents_document_type_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vihem_documents_document_type_check'
      AND conrelid = 'vihem_documents'::regclass
  ) THEN
    ALTER TABLE vihem_documents
      ADD CONSTRAINT vihem_documents_document_type_check
      CHECK (document_type IN ('contract','rules','inspection','invoice','notice','certificate','template','other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vihem_documents_document_category_check'
      AND conrelid = 'vihem_documents'::regclass
  ) THEN
    ALTER TABLE vihem_documents
      ADD CONSTRAINT vihem_documents_document_category_check
      CHECK (document_category IN (
        'residential_lease',
        'premises_lease',
        'parking_agreement',
        'storage_agreement',
        'lease_addendum',
        'termination',
        'inspection_protocol',
        'house_rules',
        'rent_notice',
        'invoice',
        'template',
        'other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vihem_documents_contract_status_check'
      AND conrelid = 'vihem_documents'::regclass
  ) THEN
    ALTER TABLE vihem_documents
      ADD CONSTRAINT vihem_documents_contract_status_check
      CHECK (contract_status IN ('not_applicable','draft','pending_signature','signed','cancelled','archived'));
  END IF;
END $$;

UPDATE vihem_documents
SET document_category = CASE
  WHEN document_type = 'contract' THEN 'residential_lease'
  WHEN document_type = 'inspection' THEN 'inspection_protocol'
  WHEN document_type = 'rules' THEN 'house_rules'
  WHEN document_type = 'invoice' THEN 'invoice'
  ELSE 'other'
END
WHERE document_category = 'other';

UPDATE vihem_documents
SET contract_status = CASE
  WHEN document_type = 'contract' THEN 'signed'
  ELSE 'not_applicable'
END
WHERE contract_status = 'not_applicable';

DROP POLICY IF EXISTS "Tenant can read own documents" ON vihem_documents;
DROP POLICY IF EXISTS "Staff can read all documents" ON vihem_documents;
DROP POLICY IF EXISTS "Admin can insert documents" ON vihem_documents;
DROP POLICY IF EXISTS "Admin can update documents" ON vihem_documents;
DROP POLICY IF EXISTS "Admin can delete documents" ON vihem_documents;
DROP POLICY IF EXISTS "VIHEM tenant can read scoped documents" ON vihem_documents;
DROP POLICY IF EXISTS "VIHEM staff can read org documents" ON vihem_documents;
DROP POLICY IF EXISTS "VIHEM staff can insert org documents" ON vihem_documents;
DROP POLICY IF EXISTS "VIHEM staff can update org documents" ON vihem_documents;
DROP POLICY IF EXISTS "VIHEM admin can delete org documents" ON vihem_documents;

CREATE POLICY "VIHEM tenant can read scoped documents"
  ON vihem_documents FOR SELECT
  TO authenticated
  USING (
    tenant_id = auth.uid()
    OR visibility = 'public'
    OR property_id IN (
      SELECT t.property_id
      FROM vihem_tenancies t
      WHERE t.tenant_id = auth.uid()
        AND t.status = 'active'
    )
    OR apartment_id IN (
      SELECT t.apartment_id
      FROM vihem_tenancies t
      WHERE t.tenant_id = auth.uid()
        AND t.status = 'active'
    )
  );

CREATE POLICY "VIHEM staff can read org documents"
  ON vihem_documents FOR SELECT
  TO authenticated
  USING (
    get_my_role() IN ('staff','admin','superadmin')
    AND (
      get_my_role() = 'superadmin'
      OR organisation_id = get_my_org_id()
      OR organisation_id IS NULL
    )
  );

CREATE POLICY "VIHEM staff can insert org documents"
  ON vihem_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() IN ('staff','admin','superadmin')
    AND (
      get_my_role() = 'superadmin'
      OR organisation_id = get_my_org_id()
      OR organisation_id IS NULL
    )
  );

CREATE POLICY "VIHEM staff can update org documents"
  ON vihem_documents FOR UPDATE
  TO authenticated
  USING (
    get_my_role() IN ('staff','admin','superadmin')
    AND (
      get_my_role() = 'superadmin'
      OR organisation_id = get_my_org_id()
      OR organisation_id IS NULL
    )
  )
  WITH CHECK (
    get_my_role() IN ('staff','admin','superadmin')
    AND (
      get_my_role() = 'superadmin'
      OR organisation_id = get_my_org_id()
      OR organisation_id IS NULL
    )
  );

CREATE POLICY "VIHEM admin can delete org documents"
  ON vihem_documents FOR DELETE
  TO authenticated
  USING (
    get_my_role() IN ('admin','superadmin')
    AND (
      get_my_role() = 'superadmin'
      OR organisation_id = get_my_org_id()
      OR organisation_id IS NULL
    )
  );

DROP POLICY IF EXISTS "VIHEM staff can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "VIHEM staff can read documents" ON storage.objects;
DROP POLICY IF EXISTS "VIHEM staff can update documents" ON storage.objects;
DROP POLICY IF EXISTS "VIHEM admin can delete documents" ON storage.objects;

CREATE POLICY "VIHEM staff can upload documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'vihem-documents'
    AND EXISTS (
      SELECT 1 FROM vihem_profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('staff','admin','superadmin')
        AND p.active = true
    )
  );

CREATE POLICY "VIHEM staff can read documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'vihem-documents'
    AND EXISTS (
      SELECT 1 FROM vihem_profiles p
      WHERE p.id = auth.uid()
        AND p.active = true
    )
  );

CREATE POLICY "VIHEM staff can update documents"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'vihem-documents'
    AND EXISTS (
      SELECT 1 FROM vihem_profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('staff','admin','superadmin')
        AND p.active = true
    )
  )
  WITH CHECK (
    bucket_id = 'vihem-documents'
    AND EXISTS (
      SELECT 1 FROM vihem_profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('staff','admin','superadmin')
        AND p.active = true
    )
  );

CREATE POLICY "VIHEM admin can delete documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'vihem-documents'
    AND EXISTS (
      SELECT 1 FROM vihem_profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin','superadmin')
        AND p.active = true
    )
  );
