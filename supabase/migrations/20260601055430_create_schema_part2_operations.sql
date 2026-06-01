/*
  # VI-HEM - Core Schema Part 2
  Creates tenancy, maintenance, work order, time tracking, and customer project tables
  used by later migrations and seed data.
*/

-- TENANCIES
CREATE TABLE IF NOT EXISTS tenancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id),
  apartment_id uuid NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date,
  monthly_rent numeric DEFAULT 0,
  contract_file_url text DEFAULT '',
  move_in_date date,
  contact_person text DEFAULT '',
  important_info text DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','terminated','ended')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE tenancies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant can read own tenancies" ON tenancies FOR SELECT TO authenticated USING (tenant_id = auth.uid());
CREATE POLICY "Staff can read all tenancies" ON tenancies FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Admin can insert tenancies" ON tenancies FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));
CREATE POLICY "Admin can update tenancies" ON tenancies FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));

-- MAINTENANCE REQUESTS
CREATE TABLE IF NOT EXISTS maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES profiles(id),
  property_id uuid REFERENCES properties(id),
  apartment_id uuid REFERENCES apartments(id),
  title text NOT NULL DEFAULT '',
  description text DEFAULT '',
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('water','electricity','heating','appliances','door_lock','ventilation','pests','internet','other')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','urgent')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','assigned','started','waiting_material','waiting_contractor','done','closed')),
  access_permission boolean NOT NULL DEFAULT false,
  preferred_times text DEFAULT '',
  contact_info jsonb DEFAULT '{}',
  assigned_to uuid REFERENCES profiles(id),
  internal_notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant can read own maintenance requests" ON maintenance_requests FOR SELECT TO authenticated USING (tenant_id = auth.uid());
CREATE POLICY "Tenant can insert own maintenance requests" ON maintenance_requests FOR INSERT TO authenticated WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Staff can read all maintenance requests" ON maintenance_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Staff can update maintenance requests" ON maintenance_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));

CREATE TABLE IF NOT EXISTS maintenance_request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  comment text NOT NULL DEFAULT '',
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE maintenance_request_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read maintenance comments" ON maintenance_request_comments FOR SELECT TO authenticated
  USING (
    request_id IN (SELECT id FROM maintenance_requests WHERE tenant_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin'))
  );
CREATE POLICY "Authenticated users can insert maintenance comments" ON maintenance_request_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- CUSTOMER PROJECTS
CREATE TABLE IF NOT EXISTS customer_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  customer_name text DEFAULT '',
  description text DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','paused','cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE customer_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read customer projects" ON customer_projects FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Admin can insert customer projects" ON customer_projects FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));
CREATE POLICY "Admin can update customer projects" ON customer_projects FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));

-- WORK ORDERS
CREATE TABLE IF NOT EXISTS work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  description text DEFAULT '',
  category text DEFAULT '',
  tags text[] DEFAULT '{}',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','assigned','started','paused','waiting_material','waiting_tenant','waiting_contractor','ready_for_check','completed','cancelled')),
  property_id uuid REFERENCES properties(id),
  apartment_id uuid REFERENCES apartments(id),
  tenant_id uuid REFERENCES profiles(id),
  customer_project_id uuid REFERENCES customer_projects(id),
  maintenance_request_id uuid REFERENCES maintenance_requests(id),
  assigned_to uuid REFERENCES profiles(id),
  created_by uuid REFERENCES profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  due_date date,
  checklist jsonb DEFAULT '[]',
  materials jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read all work orders" ON work_orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Staff can insert work orders" ON work_orders FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Staff can update work orders" ON work_orders FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));

CREATE TABLE IF NOT EXISTS work_order_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  comment text NOT NULL DEFAULT '',
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE work_order_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read work order comments" ON work_order_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Staff can insert work order comments" ON work_order_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));

-- TIME ENTRIES
CREATE TABLE IF NOT EXISTS time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  work_order_id uuid REFERENCES work_orders(id),
  maintenance_request_id uuid REFERENCES maintenance_requests(id),
  property_id uuid REFERENCES properties(id),
  customer_project_id uuid REFERENCES customer_projects(id),
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('general','work_order','maintenance','customer_project','admin','travel','shopping','standby','other')),
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  break_minutes integer NOT NULL DEFAULT 0,
  total_minutes integer NOT NULL DEFAULT 0,
  comment text DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own time entries" ON time_entries FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admin can read all time entries" ON time_entries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));
CREATE POLICY "Staff can insert own time entries" ON time_entries FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Staff can update own time entries" ON time_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
