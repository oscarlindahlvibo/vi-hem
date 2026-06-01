/*
  # FastighetsApp - Remaining Tables: Laundry, Documents, News, Terminations, Chat, Notifications
*/

-- TIME ENTRIES (indexes only, table already created)
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_work_order_id ON time_entries(work_order_id);

-- LAUNDRY ROOMS
CREATE TABLE IF NOT EXISTS laundry_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  description text DEFAULT '',
  machines jsonb DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  max_bookings_per_tenant integer DEFAULT 3,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE laundry_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read laundry rooms" ON laundry_rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can insert laundry rooms" ON laundry_rooms FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));
CREATE POLICY "Admin can update laundry rooms" ON laundry_rooms FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));

-- LAUNDRY SLOTS
CREATE TABLE IF NOT EXISTS laundry_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  laundry_room_id uuid NOT NULL REFERENCES laundry_rooms(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_blocked boolean NOT NULL DEFAULT false,
  block_reason text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE laundry_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read laundry slots" ON laundry_slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can insert laundry slots" ON laundry_slots FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));
CREATE POLICY "Admin can update laundry slots" ON laundry_slots FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));

-- LAUNDRY BOOKINGS
CREATE TABLE IF NOT EXISTS laundry_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  laundry_slot_id uuid NOT NULL REFERENCES laundry_slots(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE laundry_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant can read own bookings" ON laundry_bookings FOR SELECT TO authenticated USING (tenant_id = auth.uid());
CREATE POLICY "Tenant can insert own bookings" ON laundry_bookings FOR INSERT TO authenticated WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Tenant can update own bookings" ON laundry_bookings FOR UPDATE TO authenticated
  USING (tenant_id = auth.uid()) WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Staff can read all bookings" ON laundry_bookings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));

-- DOCUMENTS
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  file_url text DEFAULT '',
  file_name text DEFAULT '',
  file_size integer DEFAULT 0,
  document_type text NOT NULL DEFAULT 'other' CHECK (document_type IN ('contract','rules','inspection','invoice','other')),
  visibility text NOT NULL DEFAULT 'tenant' CHECK (visibility IN ('public','tenant','staff','admin')),
  tenant_id uuid REFERENCES profiles(id),
  property_id uuid REFERENCES properties(id),
  apartment_id uuid REFERENCES apartments(id),
  description text DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant can read own documents" ON documents FOR SELECT TO authenticated
  USING (
    tenant_id = auth.uid()
    OR property_id IN (SELECT t.property_id FROM tenancies t WHERE t.tenant_id = auth.uid() AND t.status = 'active')
    OR apartment_id IN (SELECT t.apartment_id FROM tenancies t WHERE t.tenant_id = auth.uid() AND t.status = 'active')
  );
CREATE POLICY "Staff can read all documents" ON documents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Admin can insert documents" ON documents FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));
CREATE POLICY "Admin can update documents" ON documents FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));

-- NEWS
CREATE TABLE IF NOT EXISTS news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  content text DEFAULT '',
  image_url text DEFAULT '',
  target_type text NOT NULL DEFAULT 'all' CHECK (target_type IN ('all','property','staircase','tenant')),
  target_id uuid,
  published_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE news ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read published news" ON news FOR SELECT TO authenticated
  USING (status = 'published' OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));
CREATE POLICY "Admin can insert news" ON news FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));
CREATE POLICY "Admin can update news" ON news FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));

-- TERMINATION REQUESTS
CREATE TABLE IF NOT EXISTS termination_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id),
  tenancy_id uuid REFERENCES tenancies(id),
  requested_move_out_date date NOT NULL,
  new_address text DEFAULT '',
  message text DEFAULT '',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','received','processing','approved','closed')),
  internal_notes text DEFAULT '',
  confirmed_by uuid REFERENCES profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE termination_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant can read own termination requests" ON termination_requests FOR SELECT TO authenticated USING (tenant_id = auth.uid());
CREATE POLICY "Tenant can insert termination requests" ON termination_requests FOR INSERT TO authenticated WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Staff can read all termination requests" ON termination_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Admin can update termination requests" ON termination_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superadmin')));

-- CHAT THREADS
CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES profiles(id),
  assigned_to uuid REFERENCES profiles(id),
  subject text DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','archived')),
  maintenance_request_id uuid REFERENCES maintenance_requests(id),
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant can read own chat threads" ON chat_threads FOR SELECT TO authenticated USING (tenant_id = auth.uid());
CREATE POLICY "Tenant can insert chat threads" ON chat_threads FOR INSERT TO authenticated WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Staff can read all chat threads" ON chat_threads FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Staff can update chat threads" ON chat_threads FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));

-- CHAT MESSAGES
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id),
  message text NOT NULL DEFAULT '',
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant can read messages in own threads" ON chat_messages FOR SELECT TO authenticated
  USING (thread_id IN (SELECT id FROM chat_threads WHERE tenant_id = auth.uid()));
CREATE POLICY "Tenant can insert messages in own threads" ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND thread_id IN (SELECT id FROM chat_threads WHERE tenant_id = auth.uid()));
CREATE POLICY "Staff can read all messages" ON chat_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Staff can insert messages" ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));
CREATE POLICY "Staff can update messages" ON chat_messages FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('staff','admin','superadmin')));

-- NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  message text DEFAULT '',
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info','maintenance','work_order','chat','laundry','news','termination','time_entry')),
  link text DEFAULT '',
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own notifications" ON notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can update own notifications" ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "System can insert notifications" ON notifications FOR INSERT TO authenticated WITH CHECK (true);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_tenancies_tenant_id ON tenancies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenancies_apartment_id ON tenancies(apartment_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_tenant_id ON maintenance_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_status ON maintenance_requests(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned_to ON work_orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
