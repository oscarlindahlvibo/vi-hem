-- Disposable contract fixture. Real snow migrations/clock are loaded on top.
-- This is not a full production-schema clone; staff-editor/notification transport are isolated stubs.
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT authenticated,anon,service_role TO postgres;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;
CREATE TABLE vihem_organisations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,slug text);
CREATE TABLE vihem_profiles(id uuid PRIMARY KEY REFERENCES auth.users,organisation_id uuid REFERENCES vihem_organisations,name text,email text,role text,active boolean DEFAULT true);
CREATE TABLE vihem_module_registry(module_key text PRIMARY KEY,name text,description text,category text,default_enabled boolean,default_limits jsonb,default_settings jsonb,sort_order int);
CREATE TABLE vihem_organisation_modules(organisation_id uuid,module_key text,enabled boolean,limits jsonb DEFAULT '{}',settings jsonb DEFAULT '{}',PRIMARY KEY(organisation_id,module_key));
CREATE TABLE vihem_permission_grants(organisation_id uuid,user_id uuid,permission_key text,granted_by uuid);
CREATE FUNCTION vihem_get_my_org_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT organisation_id FROM vihem_profiles WHERE id=auth.uid()$$;
CREATE FUNCTION vihem_get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT role FROM vihem_profiles WHERE id=auth.uid()$$;
CREATE FUNCTION vihem_module_enabled(text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT coalesce((SELECT enabled FROM vihem_organisation_modules WHERE organisation_id=vihem_get_my_org_id() AND module_key=$1),false)$$;
CREATE FUNCTION vihem_has_permission(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM vihem_permission_grants WHERE user_id=$1 AND permission_key=$2)$$;
CREATE TABLE vihem_time_categories(organisation_id uuid,key text,label text,active boolean,sort_order int,is_builtin boolean,PRIMARY KEY(organisation_id,key));
CREATE TABLE vihem_work_orders(id uuid PRIMARY KEY,organisation_id uuid);
CREATE TABLE vihem_customer_projects(id uuid PRIMARY KEY,organisation_id uuid,customer_name text);
CREATE TABLE vihem_project_change_orders(id uuid PRIMARY KEY,project_id uuid);
CREATE FUNCTION can_access_customer_project(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE TABLE vihem_time_entries(id uuid PRIMARY KEY,user_id uuid REFERENCES vihem_profiles,organisation_id uuid REFERENCES vihem_organisations,work_order_id uuid,category text,entry_type text DEFAULT 'work',customer_project_id uuid,customer_name text,project_billing_scope text,project_change_order_id uuid,start_time timestamptz NOT NULL,end_time timestamptz,break_minutes int DEFAULT 0,total_minutes int DEFAULT 0,comment text,status text,approved_by uuid,approved_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),vehicle_id uuid);
CREATE TABLE vihem_clock_operations(id uuid PRIMARY KEY,user_id uuid,organisation_id uuid,request jsonb,result jsonb,event_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE vihem_daily_work_summaries(user_id uuid,work_date date,comment text,updated_at timestamptz,PRIMARY KEY(user_id,work_date));
CREATE FUNCTION vihem_save_staff_editor(uuid,uuid,jsonb,jsonb,text[],text[]) RETURNS void LANGUAGE plpgsql AS $$DECLARE new_role text;new_system boolean;p_profile jsonb:=$3;BEGIN PERFORM 'jour','fleet_management';PERFORM 'staff','admin','superadmin','screen';IF false THEN
 UPDATE public.vihem_profiles SET name=name WHERE id=$2;
 END IF;END$$;
CREATE TABLE vihem_jour_shifts(id uuid PRIMARY KEY,organisation_id uuid,user_id uuid,duty_type text,starts_at timestamptz,ends_at timestamptz);
CREATE TABLE vihem_staff_absence_requests(id uuid PRIMARY KEY,organisation_id uuid,user_id uuid,status text,start_date date,end_date date);
CREATE TABLE vihem_companies(id uuid PRIMARY KEY,organisation_id uuid,name text);
CREATE TABLE vihem_finance_customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,company_id uuid,name text NOT NULL,customer_type text,email text DEFAULT '',phone text DEFAULT '',address_line1 text DEFAULT '',postal_code text DEFAULT '',city text DEFAULT '',organisation_number text DEFAULT '',invoice_email text DEFAULT '',country_code text DEFAULT 'SE',payment_terms_days int DEFAULT 30,active boolean DEFAULT true,created_by uuid);
CREATE TABLE vihem_fleet_vehicles(id uuid PRIMARY KEY,organisation_id uuid,name text,active boolean DEFAULT true);
CREATE TABLE vihem_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,user_id uuid,title text,message text,type text,link text,created_at timestamptz DEFAULT now());
CREATE TABLE vihem_push_deliveries(notification_id uuid,token_id uuid,status text);
CREATE TABLE vihem_accounted_invoice_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,company_id uuid,company_link_id uuid,source_type text CHECK(source_type IN ('rental_billing','customer_project','manual_charge')),source_id uuid,accounted_invoice_id text,accounted_invoice_number text,status text,total numeric,remaining_amount numeric,invoice_date date,due_date date,created_by uuid,UNIQUE(company_link_id,source_type,source_id));
CREATE FUNCTION vihem_clock_operation_status(uuid,uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$SELECT result FROM vihem_clock_operations WHERE id=$1 AND organisation_id=$2 AND user_id=auth.uid()$$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE TABLE vihem_jour_eligibility(organisation_id uuid,user_id uuid,duty_type text);
CREATE TABLE vihem_jour_rotation_rules(organisation_id uuid,duty_type text);
CREATE TABLE vihem_jour_swap_offers(organisation_id uuid,shift_id uuid,offered_by uuid);
CREATE SCHEMA storage;
CREATE TABLE storage.objects(id uuid, name text, bucket_id text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE TABLE vihem_push_tokens(id uuid DEFAULT gen_random_uuid(),user_id uuid,organisation_id uuid,platform text,token text,active boolean,last_seen_at timestamptz,UNIQUE(platform,token));
ALTER TABLE vihem_push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_token ON vihem_push_tokens FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid() AND organisation_id=vihem_get_my_org_id());
GRANT SELECT,INSERT,UPDATE ON vihem_push_tokens TO authenticated;
CREATE TABLE vihem_accounted_company_links(id uuid PRIMARY KEY,organisation_id uuid,company_id uuid);
ALTER TABLE vihem_accounted_invoice_links ADD COLUMN last_synced_at timestamptz;
ALTER TABLE vihem_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_read ON vihem_profiles FOR SELECT TO authenticated USING(id=auth.uid() OR (organisation_id=vihem_get_my_org_id() AND vihem_get_my_role() IN ('admin','superadmin')));
ALTER TABLE vihem_time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY time_read ON vihem_time_entries FOR SELECT TO authenticated USING(user_id=auth.uid() OR (organisation_id=vihem_get_my_org_id() AND vihem_get_my_role() IN ('admin','superadmin')));
CREATE POLICY time_write ON vihem_time_entries FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid() AND organisation_id=vihem_get_my_org_id());
GRANT UPDATE ON vihem_time_entries TO authenticated;

CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT ON storage.objects TO authenticated;

CREATE FUNCTION vihem_user_has_company_access(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM vihem_profiles WHERE id=auth.uid() AND active AND role IN ('admin','superadmin'))$$;
