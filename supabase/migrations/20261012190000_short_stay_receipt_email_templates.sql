-- Additive mail preferences. No changes to bookings, financial data or old clients.
CREATE TABLE IF NOT EXISTS public.vihem_receipt_email_settings (
 organisation_id uuid PRIMARY KEY REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
 message text NOT NULL CHECK (length(message) BETWEEN 1 AND 6000),
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vihem_receipt_email_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org admins read receipt mail settings" ON public.vihem_receipt_email_settings;
CREATE POLICY "Org admins read receipt mail settings" ON public.vihem_receipt_email_settings FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM vihem_profiles p WHERE p.id=auth.uid() AND p.active AND p.role='admin' AND p.organisation_id=vihem_receipt_email_settings.organisation_id));
GRANT SELECT ON public.vihem_receipt_email_settings TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.vihem_receipt_email_settings FROM authenticated;
GRANT ALL ON public.vihem_receipt_email_settings TO service_role;
ALTER TABLE public.vihem_short_stay_receipt_emails ADD COLUMN IF NOT EXISTS email_subject text;
ALTER TABLE public.vihem_short_stay_receipt_emails ADD COLUMN IF NOT EXISTS email_message text;
NOTIFY pgrst,'reload schema';
