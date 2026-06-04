CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id) ON DELETE CASCADE,
  store_name text NOT NULL,
  item_name text NOT NULL,
  quantity text NOT NULL DEFAULT '',
  product_url text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'purchased', 'cancelled')),
  created_by uuid REFERENCES profiles(id),
  purchased_by uuid REFERENCES profiles(id),
  purchased_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_purchase_items_org_status
  ON purchase_items(organisation_id, status, store_name);

CREATE OR REPLACE FUNCTION set_purchase_items_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_purchase_items_updated_at ON purchase_items;
CREATE TRIGGER update_purchase_items_updated_at
  BEFORE UPDATE ON purchase_items
  FOR EACH ROW
  EXECUTE FUNCTION set_purchase_items_updated_at();

DROP POLICY IF EXISTS "Org staff can read purchase items" ON purchase_items;
CREATE POLICY "Org staff can read purchase items"
  ON purchase_items FOR SELECT
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']));

DROP POLICY IF EXISTS "Org staff can insert purchase items" ON purchase_items;
CREATE POLICY "Org staff can insert purchase items"
  ON purchase_items FOR INSERT
  TO authenticated
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND created_by = auth.uid()
    AND get_my_role() = ANY (ARRAY['staff','admin'])
  );

DROP POLICY IF EXISTS "Org staff can update purchase items" ON purchase_items;
CREATE POLICY "Org staff can update purchase items"
  ON purchase_items FOR UPDATE
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']))
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() = ANY (ARRAY['staff','admin']));

DROP POLICY IF EXISTS "Org admin can delete purchase items" ON purchase_items;
CREATE POLICY "Org admin can delete purchase items"
  ON purchase_items FOR DELETE
  TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() = 'admin');
