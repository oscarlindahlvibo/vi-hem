-- Allow supplier invoice attachments to live in the shared VI-HEM document library.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vihem_documents_document_category_check'
      AND conrelid = 'vihem_documents'::regclass
  ) THEN
    ALTER TABLE public.vihem_documents
      DROP CONSTRAINT vihem_documents_document_category_check;
  END IF;

  ALTER TABLE public.vihem_documents
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
      'supplier_invoice',
      'template',
      'other'
    ));
END $$;
