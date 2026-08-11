-- Receipts share the OCR storage and review pipeline, but are not payable supplier invoices.
ALTER TABLE public.vihem_supplier_invoices
  ALTER COLUMN due_date DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vihem_documents_document_category_check'
      AND conrelid = 'public.vihem_documents'::regclass
  ) THEN
    ALTER TABLE public.vihem_documents
      DROP CONSTRAINT vihem_documents_document_category_check;
  END IF;

  ALTER TABLE public.vihem_documents
    ADD CONSTRAINT vihem_documents_document_category_check
    CHECK (document_category IN (
      'residential_lease', 'premises_lease', 'parking_agreement', 'storage_agreement',
      'lease_addendum', 'termination', 'inspection_protocol', 'house_rules', 'rent_notice',
      'invoice', 'supplier_invoice', 'receipt', 'template', 'other'
    ));
END $$;

CREATE INDEX IF NOT EXISTS vihem_supplier_invoices_kind_idx
  ON public.vihem_supplier_invoices (organisation_id, document_kind, invoice_date DESC);
