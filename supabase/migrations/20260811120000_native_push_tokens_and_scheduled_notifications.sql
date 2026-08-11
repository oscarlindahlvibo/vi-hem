CREATE TABLE IF NOT EXISTS public.vihem_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(platform, token)
);

CREATE INDEX IF NOT EXISTS vihem_push_tokens_user_idx ON public.vihem_push_tokens(user_id, active);
CREATE INDEX IF NOT EXISTS vihem_push_tokens_org_idx ON public.vihem_push_tokens(organisation_id, active);
ALTER TABLE public.vihem_push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own push tokens" ON public.vihem_push_tokens;
CREATE POLICY "Users manage own push tokens" ON public.vihem_push_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND organisation_id = public.get_my_org_id());

CREATE TABLE IF NOT EXISTS public.vihem_notification_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  delivery_key text NOT NULL,
  notification_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, delivery_key)
);

ALTER TABLE public.vihem_notification_delivery_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own notification delivery log" ON public.vihem_notification_delivery_log;
CREATE POLICY "Users can read own notification delivery log" ON public.vihem_notification_delivery_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());
