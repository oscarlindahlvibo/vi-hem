BEGIN;
ALTER TABLE public.vihem_personal_notes ADD COLUMN preview text GENERATED ALWAYS AS (left(plain_text,240)) STORED;
-- A permissive policy from another module cannot grant access to this bucket.
CREATE POLICY personal_storage_guard ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING(bucket_id<>'vihem-personal' OR ((storage.foldername(name))[1]=auth.uid()::text AND EXISTS(SELECT 1 FROM public.vihem_profiles WHERE id=auth.uid() AND active AND role IN ('staff','admin','superadmin'))))
WITH CHECK(bucket_id<>'vihem-personal' OR ((storage.foldername(name))[1]=auth.uid()::text AND EXISTS(SELECT 1 FROM public.vihem_personal_notes WHERE id::text=(storage.foldername(name))[2] AND owner_id=auth.uid())));
ALTER TABLE public.vihem_personal_reminders ADD COLUMN recurrence_day integer CHECK(recurrence_day BETWEEN 1 AND 31);
ALTER TABLE public.vihem_personal_reminders ADD COLUMN recurrence_time time;
CREATE FUNCTION public.vihem_personal_recurrence_anchor() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.due_at IS DISTINCT FROM OLD.due_at AND NEW.recurrence IS DISTINCT FROM 'none' OR NEW.recurrence IS DISTINCT FROM OLD.recurrence THEN
  -- Completion explicitly preserves anchors while updating due_at.
  IF current_setting('vihem.personal_completing',true) IS DISTINCT FROM 'yes' THEN
   NEW.recurrence_day:=extract(day FROM NEW.due_at AT TIME ZONE NEW.timezone);
   NEW.recurrence_time:=(NEW.due_at AT TIME ZONE NEW.timezone)::time;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_recurrence_anchor BEFORE INSERT OR UPDATE ON public.vihem_personal_reminders FOR EACH ROW EXECUTE FUNCTION public.vihem_personal_recurrence_anchor();
CREATE OR REPLACE FUNCTION public.vihem_personal_complete_reminder(p_id uuid,p_expected integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=vihem_personal_require_owner(); r vihem_personal_reminders; d timestamp; anchor integer; local_time time; month_start date;
BEGIN
 SELECT * INTO r FROM vihem_personal_reminders WHERE id=p_id AND owner_id=u FOR UPDATE;
 IF NOT FOUND OR r.revision<>p_expected OR r.cancelled_at IS NOT NULL OR r.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Påminnelsekonflikt' USING ERRCODE='40001'; END IF;
 IF r.recurrence='none' THEN UPDATE vihem_personal_reminders SET completed_at=now(),revision=revision+1 WHERE id=r.id;
 ELSE
  d:=r.due_at AT TIME ZONE r.timezone;anchor:=coalesce(r.recurrence_day,extract(day FROM d)::integer);local_time:=coalesce(r.recurrence_time,d::time);
  LOOP
   IF r.recurrence='monthly' THEN
    month_start:=(date_trunc('month',d)+interval '1 month')::date;
    d:=month_start+(least(anchor,extract(day FROM month_start+interval '1 month - 1 day')::integer)-1)+local_time;
   ELSIF r.recurrence='weekdays' THEN
    LOOP d:=(d::date+1)+local_time;EXIT WHEN extract(isodow FROM d)::integer=ANY(r.weekdays);END LOOP;
   ELSE d:=(d::date+CASE r.recurrence WHEN 'daily' THEN 1 WHEN 'interval' THEN r.repeat_every ELSE 7 END)+local_time;
   END IF;
   EXIT WHEN (d AT TIME ZONE r.timezone)>now();
  END LOOP;
  PERFORM set_config('vihem.personal_completing','yes',true);
  UPDATE vihem_personal_reminders SET due_at=d AT TIME ZONE r.timezone,revision=revision+1,updated_at=now() WHERE id=r.id;
  PERFORM set_config('vihem.personal_completing','no',true);
 END IF;
END $$;
-- Reject corrupt or unbounded vector input at the boundary.
CREATE FUNCTION public.vihem_personal_valid_stroke(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE p jsonb;
BEGIN
 IF jsonb_typeof(v->'points') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'points') NOT BETWEEN 1 AND 25000
 OR coalesce(v->>'tool','') NOT IN ('pen','highlight','line') OR coalesce(v->>'color','') !~ '^#[0-9a-fA-F]{6}$'
 OR jsonb_typeof(v->'width') IS DISTINCT FROM 'number' OR (v->>'width')::numeric NOT BETWEEN 0.1 AND 100 THEN RETURN false; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(v->'points') LOOP
  IF jsonb_typeof(p->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'y') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'p') IS DISTINCT FROM 'number'
  OR abs((p->>'x')::numeric)>100000 OR abs((p->>'y')::numeric)>100000 OR (p->>'p')::numeric NOT BETWEEN 0 AND 1 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
ALTER TABLE public.vihem_personal_ink_strokes ADD CONSTRAINT valid_vector CHECK(public.vihem_personal_valid_stroke(stroke)) NOT VALID;
-- Owner-only retention operation; never removes notes, ink, attachments or trash.
CREATE FUNCTION public.vihem_personal_maintenance() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 DELETE FROM vihem_personal_mutations WHERE created_at<now()-interval '90 days';GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.vihem_personal_maintenance() FROM PUBLIC,authenticated,anon;
GRANT EXECUTE ON FUNCTION public.vihem_personal_maintenance() TO service_role;
COMMIT;
