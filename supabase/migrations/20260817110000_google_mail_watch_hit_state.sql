ALTER TABLE public.vihem_mail_watch_hits
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleared_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE public.vihem_mail_watch_hits ADD CONSTRAINT vihem_mail_watch_hits_payment_status_check CHECK (payment_status IN ('paid', 'unpaid'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.vihem_mail_watch_hits ADD CONSTRAINT vihem_mail_watch_hits_visibility_status_check CHECK (visibility_status IN ('active', 'cleared'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS vihem_mail_watch_hits_payment_idx ON public.vihem_mail_watch_hits(organisation_id, payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_mail_watch_hits_visibility_idx ON public.vihem_mail_watch_hits(organisation_id, visibility_status, created_at DESC);

ALTER TABLE public.vihem_mail_audit_events DROP CONSTRAINT IF EXISTS vihem_mail_audit_events_action_check;
ALTER TABLE public.vihem_mail_audit_events ADD CONSTRAINT vihem_mail_audit_events_action_check CHECK (action IN (
  'account_created', 'account_updated', 'account_deleted', 'connection_tested', 'search',
  'message_read', 'attachment_downloaded', 'attachment_linked', 'watch_rule_created', 'watch_rule_updated',
  'watch_rule_deleted', 'watch_run', 'watch_hit_updated'
));
