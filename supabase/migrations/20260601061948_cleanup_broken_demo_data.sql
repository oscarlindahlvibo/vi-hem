/*
  # Remove broken demo data and auth users
  Clears all demo data tables so we can recreate with proper auth users.
*/

-- Remove in dependency order
DELETE FROM notifications WHERE user_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
DELETE FROM chat_messages WHERE sender_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
DELETE FROM chat_threads WHERE tenant_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
DELETE FROM time_entries WHERE user_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
DELETE FROM work_order_comments WHERE user_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
DELETE FROM laundry_bookings WHERE tenant_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
DELETE FROM termination_requests WHERE tenant_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
DELETE FROM maintenance_request_comments WHERE user_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
UPDATE work_orders SET assigned_to = NULL WHERE assigned_to IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
UPDATE work_orders SET created_by = NULL WHERE created_by IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
UPDATE work_orders SET tenant_id = NULL WHERE tenant_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
UPDATE maintenance_requests SET assigned_to = NULL WHERE assigned_to IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
UPDATE maintenance_requests SET tenant_id = NULL WHERE tenant_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
UPDATE tenancies SET tenant_id = '00000000-0000-0000-0000-000000000004' WHERE FALSE; -- placeholder
DELETE FROM tenancies WHERE tenant_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
DELETE FROM documents WHERE tenant_id IN (SELECT id FROM profiles WHERE email LIKE '%demo.se') OR created_by IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
DELETE FROM news WHERE created_by IN (SELECT id FROM profiles WHERE email LIKE '%demo.se');
DELETE FROM profiles WHERE email LIKE '%demo.se';

-- Now remove the bad auth users
DELETE FROM auth.users WHERE email LIKE '%demo.se';

-- Also clear remaining demo entities so we can reseed cleanly
DELETE FROM work_orders;
DELETE FROM maintenance_requests;
DELETE FROM laundry_slots;
DELETE FROM laundry_bookings;
DELETE FROM laundry_rooms;
DELETE FROM apartments;
DELETE FROM customer_projects;
DELETE FROM properties;
