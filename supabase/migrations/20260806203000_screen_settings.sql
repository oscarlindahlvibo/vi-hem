CREATE TABLE IF NOT EXISTS public.vihem_screen_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  screen_key text NOT NULL DEFAULT 'default',
  screen_view text NOT NULL DEFAULT 'presentation' CHECK (screen_view IN ('short-stay', 'work-orders', 'presentation')),
  presentation_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, screen_key)
);

CREATE INDEX IF NOT EXISTS idx_vihem_screen_settings_org
  ON public.vihem_screen_settings(organisation_id);

ALTER TABLE public.vihem_screen_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read own screen settings" ON public.vihem_screen_settings;
CREATE POLICY "Members can read own screen settings"
  ON public.vihem_screen_settings
  FOR SELECT
  TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() IN ('screen', 'staff', 'admin', 'superadmin')
  );

DROP POLICY IF EXISTS "Admins can manage own screen settings" ON public.vihem_screen_settings;
CREATE POLICY "Admins can manage own screen settings"
  ON public.vihem_screen_settings
  FOR ALL
  TO authenticated
  USING (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() IN ('admin', 'superadmin')
  )
  WITH CHECK (
    organisation_id = public.get_my_org_id()
    AND public.get_my_role() IN ('admin', 'superadmin')
  );
