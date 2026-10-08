BEGIN;
CREATE FUNCTION public.vihem_valid_message_translations(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE item record;
BEGIN
 IF value IS NULL OR jsonb_typeof(value) <> 'object' OR value = '{}'::jsonb THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_each(value) LOOP
  IF item.key !~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$' OR jsonb_typeof(item.value) <> 'string'
   OR length(btrim(item.value #>> '{}')) NOT BETWEEN 1 AND 5000 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.vihem_valid_message_translations(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_valid_message_translations(jsonb) TO authenticated, service_role;
CREATE TABLE public.vihem_short_stay_message_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),
 unit_id uuid NOT NULL REFERENCES public.vihem_short_stay_units(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 translations jsonb NOT NULL CHECK (public.vihem_valid_message_translations(translations)),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON public.vihem_short_stay_message_templates (organisation_id, unit_id, lower(btrim(name)));
ALTER TABLE public.vihem_short_stay_message_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_short_stay_message_templates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vihem_short_stay_message_templates TO authenticated;
GRANT ALL ON public.vihem_short_stay_message_templates TO service_role;
CREATE POLICY staff_read ON public.vihem_short_stay_message_templates FOR SELECT TO authenticated USING (
 organisation_id = public.vihem_get_my_org_id() AND public.is_short_stay_enabled(organisation_id)
 AND public.vihem_get_my_role() IN ('admin','superadmin','staff')
);
CREATE POLICY admin_write ON public.vihem_short_stay_message_templates FOR ALL TO authenticated USING (
 organisation_id = public.vihem_get_my_org_id() AND public.is_short_stay_enabled(organisation_id)
 AND public.vihem_get_my_role() IN ('admin','superadmin')
) WITH CHECK (
 organisation_id = public.vihem_get_my_org_id() AND public.is_short_stay_enabled(organisation_id)
 AND public.vihem_get_my_role() IN ('admin','superadmin')
 AND EXISTS (SELECT 1 FROM public.vihem_short_stay_units u WHERE u.id = unit_id AND u.organisation_id = vihem_short_stay_message_templates.organisation_id)
);
CREATE POLICY service_all ON public.vihem_short_stay_message_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE FUNCTION public.vihem_touch_message_template() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.vihem_touch_message_template() FROM PUBLIC;
CREATE TRIGGER touch_template BEFORE UPDATE ON public.vihem_short_stay_message_templates FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_message_template();
NOTIFY pgrst, 'reload schema';
COMMIT;
