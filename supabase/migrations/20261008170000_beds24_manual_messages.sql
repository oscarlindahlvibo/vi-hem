BEGIN;
CREATE TABLE public.vihem_short_stay_message_sends (
 id uuid PRIMARY KEY,
 organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),
 unit_id uuid NOT NULL REFERENCES public.vihem_short_stay_units(id),
 beds24_booking_id text NOT NULL,
 sender_id uuid NOT NULL,
 message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 5000),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vihem_short_stay_message_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_short_stay_message_sends FROM anon, authenticated;
GRANT SELECT ON public.vihem_short_stay_message_sends TO authenticated;
GRANT ALL ON public.vihem_short_stay_message_sends TO service_role;
CREATE POLICY staff_read ON public.vihem_short_stay_message_sends FOR SELECT TO authenticated USING (
 organisation_id = public.vihem_get_my_org_id() AND public.is_short_stay_enabled(organisation_id)
 AND public.vihem_get_my_role() IN ('admin','superadmin','staff')
);
CREATE POLICY service_all ON public.vihem_short_stay_message_sends FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX ON public.vihem_short_stay_message_sends (organisation_id, beds24_booking_id, created_at);
CREATE UNIQUE INDEX ON public.vihem_short_stay_message_sends (organisation_id, beds24_booking_id, md5(message)) WHERE status = 'pending';
NOTIFY pgrst, 'reload schema';
COMMIT;
