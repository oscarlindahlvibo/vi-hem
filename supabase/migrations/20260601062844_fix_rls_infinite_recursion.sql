/*
  # Fix infinite recursion in profiles RLS policies

  The policies on 'profiles' were querying 'profiles' itself to check the user's role,
  causing infinite recursion. Fix: create a SECURITY DEFINER function that bypasses RLS
  to get the current user's role, then rewrite all role-checking policies to use it.
*/

-- Create a security definer function to get current user's role without triggering RLS
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- Drop the recursive policies on profiles
DROP POLICY IF EXISTS "Staff and above can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can update all profiles" ON profiles;

-- Recreate them using the safe function
CREATE POLICY "Staff can read all profiles"
  ON profiles FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));

CREATE POLICY "Admin can insert profiles"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

CREATE POLICY "Admin can update all profiles"
  ON profiles FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- Fix the same recursion pattern across ALL other tables that use the same subquery
-- (they query profiles inside the policy, which was fine before since profiles
--  had a working self-policy, but now we standardize on get_my_role())

-- PROPERTIES
DROP POLICY IF EXISTS "Admin can insert properties" ON properties;
DROP POLICY IF EXISTS "Admin can update properties" ON properties;
CREATE POLICY "Admin can insert properties" ON properties FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','superadmin'));
CREATE POLICY "Admin can update properties" ON properties FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- APARTMENTS
DROP POLICY IF EXISTS "Staff can read apartments" ON apartments;
DROP POLICY IF EXISTS "Admin can insert apartments" ON apartments;
DROP POLICY IF EXISTS "Admin can update apartments" ON apartments;
CREATE POLICY "Staff can read apartments" ON apartments FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Admin can insert apartments" ON apartments FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','superadmin'));
CREATE POLICY "Admin can update apartments" ON apartments FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- TENANCIES
DROP POLICY IF EXISTS "Staff can read all tenancies" ON tenancies;
DROP POLICY IF EXISTS "Admin can insert tenancies" ON tenancies;
DROP POLICY IF EXISTS "Admin can update tenancies" ON tenancies;
CREATE POLICY "Staff can read all tenancies" ON tenancies FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Admin can insert tenancies" ON tenancies FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','superadmin'));
CREATE POLICY "Admin can update tenancies" ON tenancies FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- CUSTOMER PROJECTS
DROP POLICY IF EXISTS "Staff can read customer projects" ON customer_projects;
DROP POLICY IF EXISTS "Admin can insert customer projects" ON customer_projects;
DROP POLICY IF EXISTS "Admin can update customer projects" ON customer_projects;
CREATE POLICY "Staff can read customer projects" ON customer_projects FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Admin can insert customer projects" ON customer_projects FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','superadmin'));
CREATE POLICY "Admin can update customer projects" ON customer_projects FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- MAINTENANCE REQUESTS
DROP POLICY IF EXISTS "Staff can read all maintenance requests" ON maintenance_requests;
DROP POLICY IF EXISTS "Staff can update maintenance requests" ON maintenance_requests;
CREATE POLICY "Staff can read all maintenance requests" ON maintenance_requests FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Staff can update maintenance requests" ON maintenance_requests FOR UPDATE TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'))
  WITH CHECK (get_my_role() IN ('staff','admin','superadmin'));

-- MAINTENANCE REQUEST COMMENTS
DROP POLICY IF EXISTS "Staff can insert comments" ON maintenance_request_comments;
DROP POLICY IF EXISTS "Tenant can read non-internal comments on own requests" ON maintenance_request_comments;
CREATE POLICY "Tenant can read non-internal comments on own requests"
  ON maintenance_request_comments FOR SELECT TO authenticated
  USING (
    (internal = false AND request_id IN (SELECT id FROM maintenance_requests WHERE tenant_id = auth.uid()))
    OR get_my_role() IN ('staff','admin','superadmin')
  );
CREATE POLICY "Staff can insert comments" ON maintenance_request_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND get_my_role() IN ('staff','admin','superadmin'));

-- WORK ORDERS
DROP POLICY IF EXISTS "Staff can read all work orders" ON work_orders;
DROP POLICY IF EXISTS "Staff can insert work orders" ON work_orders;
DROP POLICY IF EXISTS "Staff can update work orders" ON work_orders;
CREATE POLICY "Staff can read all work orders" ON work_orders FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Staff can insert work orders" ON work_orders FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Staff can update work orders" ON work_orders FOR UPDATE TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'))
  WITH CHECK (get_my_role() IN ('staff','admin','superadmin'));

-- WORK ORDER COMMENTS
DROP POLICY IF EXISTS "Staff can read work order comments" ON work_order_comments;
DROP POLICY IF EXISTS "Staff can insert work order comments" ON work_order_comments;
CREATE POLICY "Staff can read work order comments" ON work_order_comments FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Staff can insert work order comments" ON work_order_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND get_my_role() IN ('staff','admin','superadmin'));

-- TIME ENTRIES
DROP POLICY IF EXISTS "Admin can read all time entries" ON time_entries;
DROP POLICY IF EXISTS "Staff can insert own time entries" ON time_entries;
DROP POLICY IF EXISTS "Staff can update own time entries" ON time_entries;
CREATE POLICY "Admin can read all time entries" ON time_entries FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin','superadmin'));
CREATE POLICY "Staff can insert own time entries" ON time_entries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Staff can update own time entries" ON time_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR get_my_role() IN ('admin','superadmin'))
  WITH CHECK (user_id = auth.uid() OR get_my_role() IN ('admin','superadmin'));

-- LAUNDRY ROOMS
DROP POLICY IF EXISTS "Admin can insert laundry rooms" ON laundry_rooms;
DROP POLICY IF EXISTS "Admin can update laundry rooms" ON laundry_rooms;
CREATE POLICY "Admin can insert laundry rooms" ON laundry_rooms FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','superadmin'));
CREATE POLICY "Admin can update laundry rooms" ON laundry_rooms FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- LAUNDRY SLOTS
DROP POLICY IF EXISTS "Admin can insert laundry slots" ON laundry_slots;
DROP POLICY IF EXISTS "Admin can update laundry slots" ON laundry_slots;
CREATE POLICY "Admin can insert laundry slots" ON laundry_slots FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','superadmin'));
CREATE POLICY "Admin can update laundry slots" ON laundry_slots FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- LAUNDRY BOOKINGS
DROP POLICY IF EXISTS "Staff can read all bookings" ON laundry_bookings;
CREATE POLICY "Staff can read all bookings" ON laundry_bookings FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));

-- DOCUMENTS
DROP POLICY IF EXISTS "Staff can read all documents" ON documents;
DROP POLICY IF EXISTS "Admin can insert documents" ON documents;
DROP POLICY IF EXISTS "Admin can update documents" ON documents;
CREATE POLICY "Staff can read all documents" ON documents FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Admin can insert documents" ON documents FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','superadmin'));
CREATE POLICY "Admin can update documents" ON documents FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- NEWS
DROP POLICY IF EXISTS "Authenticated users can read published news" ON news;
DROP POLICY IF EXISTS "Admin can insert news" ON news;
DROP POLICY IF EXISTS "Admin can update news" ON news;
CREATE POLICY "Authenticated users can read published news" ON news FOR SELECT TO authenticated
  USING (status = 'published' OR get_my_role() IN ('admin','superadmin'));
CREATE POLICY "Admin can insert news" ON news FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','superadmin'));
CREATE POLICY "Admin can update news" ON news FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- TERMINATION REQUESTS
DROP POLICY IF EXISTS "Staff can read all termination requests" ON termination_requests;
DROP POLICY IF EXISTS "Admin can update termination requests" ON termination_requests;
CREATE POLICY "Staff can read all termination requests" ON termination_requests FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Admin can update termination requests" ON termination_requests FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','superadmin'))
  WITH CHECK (get_my_role() IN ('admin','superadmin'));

-- CHAT THREADS
DROP POLICY IF EXISTS "Staff can read all chat threads" ON chat_threads;
DROP POLICY IF EXISTS "Staff can update chat threads" ON chat_threads;
CREATE POLICY "Staff can read all chat threads" ON chat_threads FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Staff can update chat threads" ON chat_threads FOR UPDATE TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'))
  WITH CHECK (get_my_role() IN ('staff','admin','superadmin'));

-- CHAT MESSAGES
DROP POLICY IF EXISTS "Staff can read all messages" ON chat_messages;
DROP POLICY IF EXISTS "Staff can insert messages" ON chat_messages;
DROP POLICY IF EXISTS "Staff can update messages" ON chat_messages;
CREATE POLICY "Staff can read all messages" ON chat_messages FOR SELECT TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Staff can insert messages" ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND get_my_role() IN ('staff','admin','superadmin'));
CREATE POLICY "Staff can update messages" ON chat_messages FOR UPDATE TO authenticated
  USING (get_my_role() IN ('staff','admin','superadmin'))
  WITH CHECK (get_my_role() IN ('staff','admin','superadmin'));
