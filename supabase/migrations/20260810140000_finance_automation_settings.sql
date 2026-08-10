/*
  # VI-HEM finance automation settings

  Stores organisation-level defaults for finance cron. Server cron can still
  override each run through the request body, but otherwise uses these settings.
*/

CREATE TABLE IF NOT EXISTS public.vihem_finance_automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  finance_cron_enabled boolean NOT NULL DEFAULT true,
  queue_reminders boolean NOT NULL DEFAULT true,
  send_emails boolean NOT NULL DEFAULT false,
  email_limit integer NOT NULL DEFAULT 20 CHECK (email_limit BETWEEN 1 AND 50),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id)
);

CREATE INDEX IF NOT EXISTS vihem_finance_automation_settings_org_idx
  ON public.vihem_finance_automation_settings (organisation_id);

ALTER TABLE public.vihem_finance_automation_settings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_finance_automation_settings;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_finance_automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

DROP TRIGGER IF EXISTS vihem_finance_audit_trigger ON public.vihem_finance_automation_settings;
CREATE TRIGGER vihem_finance_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_finance_automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.vihem_finance_audit_trigger();

DROP POLICY IF EXISTS "VIHEM finance automation settings read" ON public.vihem_finance_automation_settings;
CREATE POLICY "VIHEM finance automation settings read"
  ON public.vihem_finance_automation_settings FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS "VIHEM finance automation settings write" ON public.vihem_finance_automation_settings;
CREATE POLICY "VIHEM finance automation settings write"
  ON public.vihem_finance_automation_settings FOR ALL TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  )
  WITH CHECK (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  );

NOTIFY pgrst, 'reload schema';
