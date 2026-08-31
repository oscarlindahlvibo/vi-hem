-- Notification type toggles (work_order_assigned, chat_message,
-- shift_start_reminder, ...) only exist per-organisation today
-- (vihem_organisation_notification_settings + notification_enabled(),
-- see 20260616093000_vihem_namespace_tables.sql:365 and the UI in
-- AdminStaffPage.tsx). Add a per-user layer on top: a user's own setting
-- wins if present, else the organisation's, else on by default.

CREATE TABLE IF NOT EXISTS public.vihem_user_notification_settings (
  user_id uuid PRIMARY KEY REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.vihem_user_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notification settings" ON public.vihem_user_notification_settings;
CREATE POLICY "Users manage own notification settings"
  ON public.vihem_user_notification_settings FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND organisation_id = public.vihem_get_my_org_id());

DROP POLICY IF EXISTS "Admins can read org notification settings" ON public.vihem_user_notification_settings;
CREATE POLICY "Admins can read org notification settings"
  ON public.vihem_user_notification_settings FOR SELECT
  TO authenticated
  USING (
    organisation_id = public.vihem_get_my_org_id()
    AND public.vihem_get_my_role() IN ('admin', 'superadmin')
  );

CREATE OR REPLACE FUNCTION public.notification_enabled_for_user(org_uuid uuid, user_uuid uuid, setting_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (settings ->> setting_key)::boolean FROM public.vihem_user_notification_settings WHERE user_id = user_uuid),
    (SELECT (settings ->> setting_key)::boolean FROM public.vihem_organisation_notification_settings WHERE organisation_id = org_uuid),
    true
  );
$$;

-- Add an optional setting_key: when passed, the recipient's own
-- preference (falling back to the org's, then on) gates the insert. Lets
-- every call site pass the relevant key instead of each trigger gating
-- an entire recipient loop up front with the org-only notification_enabled().
CREATE OR REPLACE FUNCTION public.create_notification(
  recipient_id uuid,
  org_uuid uuid,
  notification_title text,
  notification_message text,
  notification_type text,
  notification_link text DEFAULT '',
  setting_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF recipient_id IS NULL THEN
    RETURN;
  END IF;

  IF setting_key IS NOT NULL AND NOT public.notification_enabled_for_user(org_uuid, recipient_id, setting_key) THEN
    RETURN;
  END IF;

  INSERT INTO public.vihem_notifications (user_id, organisation_id, title, message, type, link)
  VALUES (recipient_id, org_uuid, notification_title, notification_message, notification_type, COALESCE(notification_link, ''));
END;
$$;

NOTIFY pgrst, 'reload schema';
