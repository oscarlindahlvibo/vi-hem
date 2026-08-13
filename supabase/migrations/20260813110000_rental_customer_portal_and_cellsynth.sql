-- Customer portal accounts, rental conversations and server-side SMS audit trail.
-- Auth credentials and Cellsynt secrets stay in Supabase Auth/Edge Function secrets.

ALTER TABLE public.vihem_rental_customers
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vihem_rental_customers_auth_user_uidx
  ON public.vihem_rental_customers(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vihem_rental_portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.vihem_rental_customers(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, customer_id),
  UNIQUE (auth_user_id)
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_customer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.vihem_rental_customers(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.vihem_rental_bookings(id) ON DELETE SET NULL,
  request_type text NOT NULL CHECK (request_type IN ('change_booking', 'cancel_booking', 'question', 'message')),
  subject text NOT NULL DEFAULT '',
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'cancelled')),
  staff_reply text NOT NULL DEFAULT '',
  handled_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_rental_customer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.vihem_rental_customers(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.vihem_rental_bookings(id) ON DELETE SET NULL,
  request_id uuid REFERENCES public.vihem_rental_customer_requests(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('customer', 'staff')),
  message text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'cellsynt',
  recipient text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  external_id text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  related_type text NOT NULL DEFAULT '',
  related_id uuid,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_sms_settings (
  organisation_id uuid PRIMARY KEY REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'cellsynt',
  sender text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_rental_portal_users_org_idx
  ON public.vihem_rental_portal_users(organisation_id, status);
CREATE INDEX IF NOT EXISTS vihem_rental_requests_org_status_idx
  ON public.vihem_rental_customer_requests(organisation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_rental_messages_customer_idx
  ON public.vihem_rental_customer_messages(customer_id, created_at);
CREATE INDEX IF NOT EXISTS vihem_sms_messages_org_created_idx
  ON public.vihem_sms_messages(organisation_id, created_at DESC);

ALTER TABLE public.vihem_rental_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_rental_customer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_rental_customer_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_sms_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM rental portal users admin" ON public.vihem_rental_portal_users;
CREATE POLICY "VIHEM rental portal users admin" ON public.vihem_rental_portal_users
  FOR ALL TO authenticated
  USING (public.vihem_get_my_role() IN ('admin', 'superadmin') AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id()))
  WITH CHECK (public.vihem_get_my_role() IN ('admin', 'superadmin') AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id()));

DROP POLICY IF EXISTS "VIHEM rental requests staff" ON public.vihem_rental_customer_requests;
CREATE POLICY "VIHEM rental requests staff" ON public.vihem_rental_customer_requests
  FOR ALL TO authenticated
  USING (public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin') AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id()))
  WITH CHECK (public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin') AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id()));

DROP POLICY IF EXISTS "VIHEM rental messages staff" ON public.vihem_rental_customer_messages;
CREATE POLICY "VIHEM rental messages staff" ON public.vihem_rental_customer_messages
  FOR ALL TO authenticated
  USING (public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin') AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id()))
  WITH CHECK (public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin') AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id()));

DROP POLICY IF EXISTS "VIHEM SMS staff" ON public.vihem_sms_messages;
CREATE POLICY "VIHEM SMS staff" ON public.vihem_sms_messages
  FOR SELECT TO authenticated
  USING (public.vihem_get_my_role() IN ('staff', 'admin', 'superadmin') AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id()));

DROP POLICY IF EXISTS "VIHEM SMS settings admin" ON public.vihem_sms_settings;
CREATE POLICY "VIHEM SMS settings admin" ON public.vihem_sms_settings
  FOR ALL TO authenticated
  USING (public.vihem_get_my_role() IN ('admin', 'superadmin') AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id()))
  WITH CHECK (public.vihem_get_my_role() IN ('admin', 'superadmin') AND (public.vihem_get_my_role() = 'superadmin' OR organisation_id = public.vihem_get_my_org_id()));

DROP TRIGGER IF EXISTS vihem_rental_portal_users_updated_at ON public.vihem_rental_portal_users;
CREATE TRIGGER vihem_rental_portal_users_updated_at BEFORE UPDATE ON public.vihem_rental_portal_users
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();
DROP TRIGGER IF EXISTS vihem_rental_requests_updated_at ON public.vihem_rental_customer_requests;
CREATE TRIGGER vihem_rental_requests_updated_at BEFORE UPDATE ON public.vihem_rental_customer_requests
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();
DROP TRIGGER IF EXISTS vihem_sms_settings_updated_at ON public.vihem_sms_settings;
CREATE TRIGGER vihem_sms_settings_updated_at BEFORE UPDATE ON public.vihem_sms_settings
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

NOTIFY pgrst, 'reload schema';
