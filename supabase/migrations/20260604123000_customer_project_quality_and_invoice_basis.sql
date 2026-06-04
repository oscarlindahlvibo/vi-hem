-- Kundprojekt version 2: self checks, inspections, deviations and invoice basis

CREATE TABLE IF NOT EXISTS project_self_check_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  description text DEFAULT '',
  checklist jsonb NOT NULL DEFAULT '[]',
  require_photo boolean NOT NULL DEFAULT false,
  require_comment boolean NOT NULL DEFAULT false,
  require_signature boolean NOT NULL DEFAULT false,
  require_date boolean NOT NULL DEFAULT true,
  require_responsible boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_self_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  template_id uuid REFERENCES project_self_check_templates(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_progress','completed','signed','requires_action')),
  performed_by uuid REFERENCES profiles(id),
  performed_at timestamptz,
  items jsonb NOT NULL DEFAULT '[]',
  notes text DEFAULT '',
  signature_name text DEFAULT '',
  signed_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  inspection_type text NOT NULL DEFAULT 'internal'
    CHECK (inspection_type IN ('internal','customer','final')),
  inspection_date date NOT NULL DEFAULT CURRENT_DATE,
  inspector_id uuid REFERENCES profiles(id),
  customer_present boolean NOT NULL DEFAULT false,
  project_status text DEFAULT '',
  result text NOT NULL DEFAULT 'requires_action'
    CHECK (result IN ('approved_without_remarks','approved_with_minor_remarks','not_approved','requires_action')),
  remarks jsonb NOT NULL DEFAULT '[]',
  photos jsonb NOT NULL DEFAULT '[]',
  notes text DEFAULT '',
  signature_name text DEFAULT '',
  signed_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_deviations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  deviation_date date NOT NULL DEFAULT CURRENT_DATE,
  reported_by uuid REFERENCES profiles(id),
  severity text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low','medium','high','critical')),
  image_url text DEFAULT '',
  proposed_action text DEFAULT '',
  responsible_id uuid REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','assigned','in_progress','resolved','closed')),
  related_type text DEFAULT '',
  related_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_invoice_basis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES customer_projects(id) ON DELETE CASCADE,
  basis_number text NOT NULL DEFAULT '',
  invoice_type text NOT NULL DEFAULT 'partial'
    CHECK (invoice_type IN ('partial','final','credit','internal')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready_for_invoicing','invoiced','do_not_invoice')),
  title text NOT NULL DEFAULT '',
  description text DEFAULT '',
  total_amount numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_invoice_basis_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  basis_id uuid NOT NULL REFERENCES project_invoice_basis(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('time','material','change_order','equipment','fixed_price','manual')),
  source_id uuid,
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'st',
  unit_price numeric NOT NULL DEFAULT 0,
  vat_rate numeric NOT NULL DEFAULT 25,
  billing_status text NOT NULL DEFAULT 'ready'
    CHECK (billing_status IN ('not_ready','ready','invoiced','do_not_invoice','included_in_quote')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_self_check_templates_org ON project_self_check_templates(organisation_id);
CREATE INDEX IF NOT EXISTS idx_project_self_checks_project ON project_self_checks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_inspections_project ON project_inspections(project_id);
CREATE INDEX IF NOT EXISTS idx_project_deviations_project ON project_deviations(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invoice_basis_project ON project_invoice_basis(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invoice_basis_lines_basis ON project_invoice_basis_lines(basis_id);

ALTER TABLE project_self_check_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_self_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_deviations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invoice_basis ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invoice_basis_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org project users can read self check templates" ON project_self_check_templates;
CREATE POLICY "Org project users can read self check templates"
  ON project_self_check_templates FOR SELECT
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND is_customer_projects_enabled(organisation_id)
    AND get_my_role() = ANY (ARRAY['staff','admin'])
  );

DROP POLICY IF EXISTS "Admins can manage self check templates" ON project_self_check_templates;
CREATE POLICY "Admins can manage self check templates"
  ON project_self_check_templates FOR ALL
  TO authenticated
  USING (organisation_id = get_my_org_id() AND is_customer_projects_enabled(organisation_id) AND get_my_role() = 'admin')
  WITH CHECK (organisation_id = get_my_org_id() AND is_customer_projects_enabled(organisation_id) AND get_my_role() = 'admin');

DROP POLICY IF EXISTS "Project members can manage self checks" ON project_self_checks;
CREATE POLICY "Project members can manage self checks"
  ON project_self_checks FOR ALL
  TO authenticated
  USING (can_access_customer_project(project_id))
  WITH CHECK (can_access_customer_project(project_id));

DROP POLICY IF EXISTS "Project members can manage inspections" ON project_inspections;
CREATE POLICY "Project members can manage inspections"
  ON project_inspections FOR ALL
  TO authenticated
  USING (can_access_customer_project(project_id))
  WITH CHECK (can_access_customer_project(project_id));

DROP POLICY IF EXISTS "Project members can manage deviations" ON project_deviations;
CREATE POLICY "Project members can manage deviations"
  ON project_deviations FOR ALL
  TO authenticated
  USING (can_access_customer_project(project_id))
  WITH CHECK (can_access_customer_project(project_id));

DROP POLICY IF EXISTS "Project members can read invoice basis" ON project_invoice_basis;
CREATE POLICY "Project members can read invoice basis"
  ON project_invoice_basis FOR SELECT
  TO authenticated
  USING (can_access_customer_project(project_id));

DROP POLICY IF EXISTS "Admins can manage invoice basis" ON project_invoice_basis;
CREATE POLICY "Admins can manage invoice basis"
  ON project_invoice_basis FOR ALL
  TO authenticated
  USING (can_access_customer_project(project_id) AND get_my_role() = 'admin')
  WITH CHECK (can_access_customer_project(project_id) AND get_my_role() = 'admin');

DROP POLICY IF EXISTS "Project members can read invoice basis lines" ON project_invoice_basis_lines;
CREATE POLICY "Project members can read invoice basis lines"
  ON project_invoice_basis_lines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM project_invoice_basis pib
      WHERE pib.id = project_invoice_basis_lines.basis_id
        AND can_access_customer_project(pib.project_id)
    )
  );

DROP POLICY IF EXISTS "Admins can manage invoice basis lines" ON project_invoice_basis_lines;
CREATE POLICY "Admins can manage invoice basis lines"
  ON project_invoice_basis_lines FOR ALL
  TO authenticated
  USING (
    get_my_role() = 'admin'
    AND EXISTS (
      SELECT 1
      FROM project_invoice_basis pib
      WHERE pib.id = project_invoice_basis_lines.basis_id
        AND can_access_customer_project(pib.project_id)
    )
  )
  WITH CHECK (
    get_my_role() = 'admin'
    AND EXISTS (
      SELECT 1
      FROM project_invoice_basis pib
      WHERE pib.id = project_invoice_basis_lines.basis_id
        AND can_access_customer_project(pib.project_id)
    )
  );
