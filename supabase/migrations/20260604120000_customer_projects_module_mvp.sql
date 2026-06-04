-- Kundprojekt MVP module

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS customer_projects_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_customer_projects integer NOT NULL DEFAULT 25;

UPDATE organisations
SET max_customer_projects = CASE
  WHEN plan = 'trial' THEN 3
  WHEN plan = 'starter' THEN 15
  WHEN plan = 'professional' THEN 100
  WHEN plan = 'enterprise' THEN 500
  ELSE max_customer_projects
END
WHERE max_customer_projects IS NULL OR max_customer_projects = 25;

CREATE OR REPLACE FUNCTION is_customer_projects_enabled(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE((
    SELECT customer_projects_enabled
    FROM organisations
    WHERE id = org_id
      AND active = true
  ), false);
$$;

CREATE TABLE IF NOT EXISTS project_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_type text NOT NULL DEFAULT 'company'
    CHECK (customer_type IN ('private','company','brf','property_owner','internal')),
  name text NOT NULL DEFAULT '',
  identity_number text DEFAULT '',
  contact_person text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  invoice_address text DEFAULT '',
  project_address text DEFAULT '',
  reference text DEFAULT '',
  notes text DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE customer_projects
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES organisations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES project_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS project_address text DEFAULT '',
  ADD COLUMN IF NOT EXISTS project_type text DEFAULT 'renovation',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN IF NOT EXISTS billing_type text NOT NULL DEFAULT 'hourly'
    CHECK (billing_type IN ('fixed_price','hourly','mixed')),
  ADD COLUMN IF NOT EXISTS project_manager_id uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS planned_end_date date,
  ADD COLUMN IF NOT EXISTS budget_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quoted_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_change_order_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoiceable_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoiced_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hourly_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internal_reference text DEFAULT '',
  ADD COLUMN IF NOT EXISTS external_reference text DEFAULT '',
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS apartment_id uuid REFERENCES apartments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

UPDATE customer_projects
SET
  title = COALESCE(title, name),
  organisation_id = COALESCE(
    organisation_id,
    (SELECT id FROM organisations ORDER BY created_at LIMIT 1)
  )
WHERE title IS NULL OR organisation_id IS NULL;

ALTER TABLE customer_projects
  ALTER COLUMN title SET DEFAULT '',
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE customer_projects
  DROP CONSTRAINT IF EXISTS customer_projects_status_check;

UPDATE customer_projects
SET status = CASE
  WHEN status = 'active' THEN 'in_progress'
  WHEN status = 'completed' THEN 'completed'
  WHEN status = 'paused' THEN 'paused'
  WHEN status = 'cancelled' THEN 'cancelled'
  ELSE 'draft'
END;

ALTER TABLE customer_projects
  ADD CONSTRAINT customer_projects_status_check
  CHECK (status IN (
    'draft','quote_created','quote_sent','quote_accepted','planned','in_progress',
    'paused','waiting_customer','waiting_material','ready_for_inspection',
    'inspected_with_remarks','approved','invoiced','completed','archived',
    'cancelled'
  ));

CREATE TABLE IF NOT EXISTS project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('project_manager','staff','viewer')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  quote_number text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','accepted','declined','expired','replaced')),
  valid_until date,
  summary text DEFAULT '',
  terms text DEFAULT '',
  payment_terms text DEFAULT '',
  total_amount numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id, version_number)
);

CREATE TABLE IF NOT EXISTS project_quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_version_id uuid NOT NULL REFERENCES project_quote_versions(id) ON DELETE CASCADE,
  line_type text NOT NULL DEFAULT 'work'
    CHECK (line_type IN ('work','material','equipment','subcontractor','discount','other')),
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'st',
  unit_price numeric NOT NULL DEFAULT 0,
  vat_rate numeric NOT NULL DEFAULT 25,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  change_order_number text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  description text DEFAULT '',
  reason text DEFAULT '',
  requested_by text DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent_to_customer','approved_by_customer','declined_by_customer','completed','invoiced','written_off')),
  billing_mode text NOT NULL DEFAULT 'separate'
    CHECK (billing_mode IN ('separate','included','internal_note','deduction')),
  estimated_amount numeric NOT NULL DEFAULT 0,
  actual_amount numeric NOT NULL DEFAULT 0,
  schedule_impact text DEFAULT '',
  customer_approved_at timestamptz,
  internal_comment text DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_material_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  change_order_id uuid REFERENCES project_change_orders(id) ON DELETE SET NULL,
  registered_by uuid REFERENCES profiles(id),
  material_date date NOT NULL DEFAULT CURRENT_DATE,
  name text NOT NULL DEFAULT '',
  description text DEFAULT '',
  quantity numeric NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'st',
  purchase_price numeric NOT NULL DEFAULT 0,
  markup_percent numeric NOT NULL DEFAULT 0,
  sale_price numeric NOT NULL DEFAULT 0,
  vat_rate numeric NOT NULL DEFAULT 25,
  supplier text DEFAULT '',
  receipt_url text DEFAULT '',
  included_in_quote boolean NOT NULL DEFAULT false,
  invoice_separately boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered','approved','invoiced')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES profiles(id),
  title text NOT NULL DEFAULT '',
  file_url text NOT NULL DEFAULT '',
  file_name text DEFAULT '',
  document_type text NOT NULL DEFAULT 'other'
    CHECK (document_type IN ('image','pdf','drawing','quote','order','receipt','invoice_basis','inspection','self_check','contract','other')),
  category text DEFAULT '',
  comment text DEFAULT '',
  before_after text CHECK (before_after IN ('before','after') OR before_after IS NULL),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comment text NOT NULL DEFAULT '',
  internal boolean NOT NULL DEFAULT true,
  related_type text DEFAULT '',
  related_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id),
  event_type text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS project_billable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS project_billing_scope text NOT NULL DEFAULT 'outside_quote'
    CHECK (project_billing_scope IN ('included_in_quote','outside_quote','internal')),
  ADD COLUMN IF NOT EXISTS project_change_order_id uuid REFERENCES project_change_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS internal_note text DEFAULT '';

CREATE OR REPLACE FUNCTION can_access_customer_project(project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM customer_projects cp
    WHERE cp.id = project_id
      AND cp.organisation_id = get_my_org_id()
      AND is_customer_projects_enabled(cp.organisation_id)
      AND (
        get_my_role() = 'admin'
        OR cp.project_manager_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM project_assignments pa
          WHERE pa.project_id = cp.id
            AND pa.user_id = auth.uid()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION is_assigned_to_customer_project(project_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM project_assignments pa
    WHERE pa.project_id = is_assigned_to_customer_project.project_id
      AND pa.user_id = is_assigned_to_customer_project.user_id
  );
$$;

CREATE OR REPLACE FUNCTION refresh_customer_project_financials(project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  time_value numeric;
  material_cost numeric;
  material_value numeric;
  change_value numeric;
BEGIN
  SELECT COALESCE(SUM((te.total_minutes::numeric / 60) * COALESCE(cp.hourly_rate, 0)), 0)
  INTO time_value
  FROM time_entries te
  JOIN customer_projects cp ON cp.id = te.customer_project_id
  WHERE te.customer_project_id = project_id
    AND te.entry_type = 'work'
    AND te.project_billable = true;

  SELECT
    COALESCE(SUM(purchase_price * quantity), 0),
    COALESCE(SUM(CASE WHEN invoice_separately THEN sale_price * quantity ELSE 0 END), 0)
  INTO material_cost, material_value
  FROM project_material_entries
  WHERE project_material_entries.project_id = refresh_customer_project_financials.project_id;

  SELECT COALESCE(SUM(CASE WHEN billing_mode = 'deduction' THEN -actual_amount ELSE actual_amount END), 0)
  INTO change_value
  FROM project_change_orders
  WHERE project_change_orders.project_id = refresh_customer_project_financials.project_id
    AND status IN ('approved_by_customer','completed','invoiced');

  UPDATE customer_projects
  SET
    actual_cost = material_cost,
    approved_change_order_amount = change_value,
    invoiceable_amount = time_value + material_value + change_value,
    updated_at = now()
  WHERE id = refresh_customer_project_financials.project_id;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_project_customers_org ON project_customers(organisation_id);
CREATE INDEX IF NOT EXISTS idx_customer_projects_org ON customer_projects(organisation_id);
CREATE INDEX IF NOT EXISTS idx_customer_projects_customer ON customer_projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_project ON project_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_user ON project_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_project_quote_versions_project ON project_quote_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_project_material_entries_project ON project_material_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_project_change_orders_project ON project_change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_activity_log_project ON project_activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_customer_project ON time_entries(customer_project_id);

ALTER TABLE project_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_quote_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_quote_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_material_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org project users can read customers" ON project_customers;
CREATE POLICY "Org project users can read customers"
  ON project_customers FOR SELECT
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND is_customer_projects_enabled(organisation_id)
    AND get_my_role() = ANY (ARRAY['staff','admin'])
  );

DROP POLICY IF EXISTS "Admins can manage project customers" ON project_customers;
CREATE POLICY "Admins can manage project customers"
  ON project_customers FOR ALL
  TO authenticated
  USING (organisation_id = get_my_org_id() AND is_customer_projects_enabled(organisation_id) AND get_my_role() = 'admin')
  WITH CHECK (organisation_id = get_my_org_id() AND is_customer_projects_enabled(organisation_id) AND get_my_role() = 'admin');

DROP POLICY IF EXISTS "Staff can read customer projects" ON customer_projects;
DROP POLICY IF EXISTS "Admin can insert customer projects" ON customer_projects;
DROP POLICY IF EXISTS "Admin can update customer projects" ON customer_projects;
DROP POLICY IF EXISTS "Org users can read enabled customer projects" ON customer_projects;
CREATE POLICY "Org users can read enabled customer projects"
  ON customer_projects FOR SELECT
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND is_customer_projects_enabled(organisation_id)
    AND (
      get_my_role() = 'admin'
      OR project_manager_id = auth.uid()
      OR is_assigned_to_customer_project(customer_projects.id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins can create enabled customer projects" ON customer_projects;
CREATE POLICY "Admins can create enabled customer projects"
  ON customer_projects FOR INSERT
  TO authenticated
  WITH CHECK (organisation_id = get_my_org_id() AND is_customer_projects_enabled(organisation_id) AND get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins and project managers can update customer projects" ON customer_projects;
CREATE POLICY "Admins and project managers can update customer projects"
  ON customer_projects FOR UPDATE
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND is_customer_projects_enabled(organisation_id)
    AND (get_my_role() = 'admin' OR project_manager_id = auth.uid())
  )
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND is_customer_projects_enabled(organisation_id)
    AND (get_my_role() = 'admin' OR project_manager_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can manage project assignments" ON project_assignments;
CREATE POLICY "Admins can manage project assignments"
  ON project_assignments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM customer_projects cp
      WHERE cp.id = project_assignments.project_id
        AND cp.organisation_id = get_my_org_id()
        AND is_customer_projects_enabled(cp.organisation_id)
        AND get_my_role() = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM customer_projects cp
      WHERE cp.id = project_assignments.project_id
        AND cp.organisation_id = get_my_org_id()
        AND is_customer_projects_enabled(cp.organisation_id)
        AND get_my_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS "Project members can read assignments" ON project_assignments;
CREATE POLICY "Project members can read assignments"
  ON project_assignments FOR SELECT
  TO authenticated
  USING (can_access_customer_project(project_id));

DROP POLICY IF EXISTS "Project users can read quote versions" ON project_quote_versions;
CREATE POLICY "Project users can read quote versions"
  ON project_quote_versions FOR SELECT
  TO authenticated
  USING (can_access_customer_project(project_id));

DROP POLICY IF EXISTS "Admins can manage quote versions" ON project_quote_versions;
CREATE POLICY "Admins can manage quote versions"
  ON project_quote_versions FOR ALL
  TO authenticated
  USING (can_access_customer_project(project_id) AND get_my_role() = 'admin')
  WITH CHECK (can_access_customer_project(project_id) AND get_my_role() = 'admin');

DROP POLICY IF EXISTS "Project users can read quote lines" ON project_quote_lines;
CREATE POLICY "Project users can read quote lines"
  ON project_quote_lines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_quote_versions qv
      WHERE qv.id = project_quote_lines.quote_version_id
        AND can_access_customer_project(qv.project_id)
    )
  );

DROP POLICY IF EXISTS "Admins can manage quote lines" ON project_quote_lines;
CREATE POLICY "Admins can manage quote lines"
  ON project_quote_lines FOR ALL
  TO authenticated
  USING (
    get_my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM project_quote_versions qv
      WHERE qv.id = project_quote_lines.quote_version_id
        AND can_access_customer_project(qv.project_id)
    )
  )
  WITH CHECK (
    get_my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM project_quote_versions qv
      WHERE qv.id = project_quote_lines.quote_version_id
        AND can_access_customer_project(qv.project_id)
    )
  );

DROP POLICY IF EXISTS "Project members can manage change orders" ON project_change_orders;
CREATE POLICY "Project members can manage change orders"
  ON project_change_orders FOR ALL
  TO authenticated
  USING (can_access_customer_project(project_id))
  WITH CHECK (can_access_customer_project(project_id));

DROP POLICY IF EXISTS "Project members can manage materials" ON project_material_entries;
CREATE POLICY "Project members can manage materials"
  ON project_material_entries FOR ALL
  TO authenticated
  USING (can_access_customer_project(project_id))
  WITH CHECK (can_access_customer_project(project_id));

DROP POLICY IF EXISTS "Project members can manage documents" ON project_documents;
CREATE POLICY "Project members can manage documents"
  ON project_documents FOR ALL
  TO authenticated
  USING (can_access_customer_project(project_id))
  WITH CHECK (can_access_customer_project(project_id));

DROP POLICY IF EXISTS "Project members can manage comments" ON project_comments;
CREATE POLICY "Project members can manage comments"
  ON project_comments FOR ALL
  TO authenticated
  USING (can_access_customer_project(project_id))
  WITH CHECK (can_access_customer_project(project_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS "Project members can read activity" ON project_activity_log;
CREATE POLICY "Project members can read activity"
  ON project_activity_log FOR SELECT
  TO authenticated
  USING (can_access_customer_project(project_id));

DROP POLICY IF EXISTS "Project system can insert activity" ON project_activity_log;
CREATE POLICY "Project system can insert activity"
  ON project_activity_log FOR INSERT
  TO authenticated
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND can_access_customer_project(project_id)
  );

DROP POLICY IF EXISTS "Project members can read project time entries" ON time_entries;
CREATE POLICY "Project members can read project time entries"
  ON time_entries FOR SELECT
  TO authenticated
  USING (
    customer_project_id IS NOT NULL
    AND can_access_customer_project(customer_project_id)
  );
