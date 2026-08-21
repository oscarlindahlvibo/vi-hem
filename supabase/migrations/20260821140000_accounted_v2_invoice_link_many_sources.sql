/*
  # Accounted V2: allow one Accounted invoice to be linked from many VI-HEM sources

  Not implementing collection/merge invoicing yet (legacy
  vihem_create_invoice_from_project_basis_batch can combine several bases
  into one invoice; that behaviour is intentionally not ported to V2 in this
  stage). This migration only removes the schema-level thing that would make
  it impossible to add later: vihem_accounted_invoice_links originally had
  `UNIQUE (company_link_id, accounted_invoice_id)`, which forces at most one
  VI-HEM source per Accounted invoice -- the wrong cardinality for a future
  "several project invoice bases -> one combined Accounted invoice" flow.

  Desired relation going forward:
    one VI-HEM source (source_type, source_id)  -> at most one Accounted invoice
    one Accounted invoice (accounted_invoice_id) -> can have many VI-HEM sources

  UNIQUE (company_link_id, source_type, source_id) already gives the first
  half and is kept unchanged. This migration only drops the constraint that
  enforced the reverse (wrong) direction, replacing it with a plain index so
  by-invoice-id lookups (webhook processing, status refresh) stay fast.

  No consumer of this table is broken by the change: every write path
  upserts on (company_link_id, source_type, source_id), never on
  accounted_invoice_id, so removing this constraint doesn't change any
  existing behaviour today -- it only stops blocking a future one.
*/

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT tc.constraint_name
  INTO constraint_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'vihem_accounted_invoice_links'
    AND tc.constraint_type = 'UNIQUE'
    AND (
      SELECT array_agg(kcu.column_name ORDER BY kcu.column_name)
      FROM information_schema.key_column_usage kcu
      WHERE kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
        AND kcu.constraint_name = tc.constraint_name
    ) = ARRAY['accounted_invoice_id', 'company_link_id'];

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.vihem_accounted_invoice_links DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vihem_accounted_invoice_links_by_invoice_idx
  ON public.vihem_accounted_invoice_links (company_link_id, accounted_invoice_id);

COMMENT ON COLUMN public.vihem_accounted_invoice_links.accounted_invoice_id IS
  'Accounted invoice id. Intentionally NOT unique per company_link_id: several '
  'rows (several VI-HEM sources) may point at the same Accounted invoice once '
  'collection/merge invoicing is built. (source_type, source_id) remains the '
  'unique key -- one VI-HEM source can still only ever be linked to one invoice.';
