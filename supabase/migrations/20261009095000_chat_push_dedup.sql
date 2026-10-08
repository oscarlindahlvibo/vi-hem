BEGIN;
CREATE TABLE public.vihem_push_deliveries(
 notification_id uuid NOT NULL REFERENCES public.vihem_notifications(id) ON DELETE CASCADE,
 token_id uuid NOT NULL REFERENCES public.vihem_push_tokens(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','unknown')),
 attempted_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 PRIMARY KEY(notification_id,token_id)
);
ALTER TABLE public.vihem_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_push_deliveries FROM anon,authenticated;
GRANT ALL ON public.vihem_push_deliveries TO service_role;
CREATE POLICY service_all ON public.vihem_push_deliveries FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE FUNCTION public.vihem_push_claim(notification uuid,device uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE claimed uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.vihem_notifications n JOIN public.vihem_push_tokens t ON t.user_id=n.user_id WHERE n.id=notification AND t.id=device AND t.active) THEN RETURN false; END IF;
 INSERT INTO public.vihem_push_deliveries(notification_id,token_id) VALUES(notification,device)
 ON CONFLICT(notification_id,token_id) DO UPDATE SET status='pending',attempted_at=now(),finished_at=NULL WHERE vihem_push_deliveries.status='failed'
 RETURNING notification_id INTO claimed;
 RETURN claimed IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.vihem_push_claim(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_push_claim(uuid,uuid) TO service_role;
COMMIT;
