-- Receipt-email ledger only. No changes to booking data or existing mail flows.
CREATE TABLE IF NOT EXISTS public.vihem_short_stay_receipt_emails (
 id uuid PRIMARY KEY,
 organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
 booking_id uuid REFERENCES public.vihem_short_stay_bookings(id) ON DELETE SET NULL,
 receipt_hash text NOT NULL CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
 recipient text NOT NULL,
 sender text NOT NULL,
 status text NOT NULL CHECK (status IN ('processing','sent','failed','uncertain')),
 created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 UNIQUE (organisation_id, booking_id, receipt_hash)
);
ALTER TABLE public.vihem_short_stay_receipt_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Active organisation admins read receipt emails" ON public.vihem_short_stay_receipt_emails;
CREATE POLICY "Active organisation admins read receipt emails" ON public.vihem_short_stay_receipt_emails FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active AND p.role='admin' AND p.organisation_id=vihem_short_stay_receipt_emails.organisation_id));
GRANT SELECT ON public.vihem_short_stay_receipt_emails TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.vihem_short_stay_receipt_emails FROM authenticated;
GRANT ALL ON public.vihem_short_stay_receipt_emails TO service_role;

NOTIFY pgrst, 'reload schema';
