/*
  # VI-HEM finance automation run log

  Stores results from scheduled finance automation jobs so admins can audit
  what cron actually did.
*/

CREATE TABLE IF NOT EXISTS public.vihem_finance_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  job_key text NOT NULL DEFAULT 'finance_cron',
  status text NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'failed')),
  overdue_updated integer NOT NULL DEFAULT 0,
  reminders_queued integer NOT NULL DEFAULT 0,
  emails_processed integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_finance_automation_runs_org_idx
  ON public.vihem_finance_automation_runs (organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vihem_finance_automation_runs_status_idx
  ON public.vihem_finance_automation_runs (status, created_at DESC);

ALTER TABLE public.vihem_finance_automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM finance automation runs read" ON public.vihem_finance_automation_runs;
CREATE POLICY "VIHEM finance automation runs read"
  ON public.vihem_finance_automation_runs FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (
      organisation_id = public.vihem_get_my_org_id()
      AND public.vihem_get_my_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS "VIHEM finance automation runs no client write" ON public.vihem_finance_automation_runs;
CREATE POLICY "VIHEM finance automation runs no client write"
  ON public.vihem_finance_automation_runs FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
