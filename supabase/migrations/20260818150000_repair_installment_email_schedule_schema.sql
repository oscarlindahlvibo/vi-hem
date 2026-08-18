-- Repair migration for installations where the original email schedule
-- migration was skipped or recorded as applied without changing the schema.

ALTER TABLE public.vihem_installment_plans
  ADD COLUMN IF NOT EXISTS email_lead_days integer NOT NULL DEFAULT 30;

ALTER TABLE public.vihem_installment_schedule
  ADD COLUMN IF NOT EXISTS email_send_date date,
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vihem_installment_plans'::regclass
      AND conname = 'vihem_installment_plans_email_lead_days_check'
  ) THEN
    ALTER TABLE public.vihem_installment_plans
      ADD CONSTRAINT vihem_installment_plans_email_lead_days_check
      CHECK (email_lead_days >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vihem_installment_schedule'::regclass
      AND conname = 'vihem_installment_schedule_email_status_check'
  ) THEN
    ALTER TABLE public.vihem_installment_schedule
      ADD CONSTRAINT vihem_installment_schedule_email_status_check
      CHECK (email_status IN ('pending', 'queued', 'sent', 'failed', 'skipped'));
  END IF;
END $$;

UPDATE public.vihem_installment_schedule s
SET email_send_date = s.due_date - p.email_lead_days
FROM public.vihem_installment_plans p
WHERE p.id = s.plan_id
  AND s.email_send_date IS NULL;

CREATE INDEX IF NOT EXISTS vihem_installment_schedule_email_queue_idx
  ON public.vihem_installment_schedule (email_status, email_send_date);

-- Make newly added columns visible immediately through PostgREST.
NOTIFY pgrst, 'reload schema';
