-- Additive interest inbox and notifications for the configured Vibo organisation.
BEGIN;
ALTER TABLE vihem_vibofast_private.enquiries
  ADD COLUMN status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','archived')),
  ADD COLUMN revision bigint NOT NULL DEFAULT 1;

CREATE FUNCTION public.vihem_vibofast_interests(p_offset integer DEFAULT 0, p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.vihem_vibofast_is_editor() THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  IF p_offset < 0 THEN RAISE EXCEPTION 'Invalid offset'; END IF;
  RETURN jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC,e.id DESC) FROM (
      SELECT * FROM vihem_vibofast_private.enquiries WHERE kind='interest' AND (p_id IS NULL OR id=p_id)
      ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET p_offset
    ) e),'[]'::jsonb),
    'total',(SELECT count(*) FROM vihem_vibofast_private.enquiries WHERE kind='interest' AND (p_id IS NULL OR id=p_id))
  );
END;
$$;
CREATE FUNCTION public.vihem_vibofast_set_interest_status(p_id uuid,p_status text,p_revision bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.vihem_vibofast_is_editor() THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  IF p_status NOT IN ('new','contacted','archived') OR p_status IS NULL THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE vihem_vibofast_private.enquiries SET status=p_status,revision=revision+1
    WHERE id=p_id AND kind='interest' AND revision=p_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'Anmälan har ändrats. Uppdatera listan och försök igen.' USING errcode='40001'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.vihem_vibofast_interests(integer,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.vihem_vibofast_set_interest_status(uuid,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_vibofast_interests(integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_vibofast_set_interest_status(uuid,text,bigint) TO authenticated;

CREATE FUNCTION vihem_vibofast_private.notify_interest_admins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE recipient record;
BEGIN
  IF NEW.kind <> 'interest' THEN RETURN NEW; END IF;
  FOR recipient IN
    SELECT p.id,p.organisation_id FROM public.vihem_profiles p
    JOIN vihem_vibofast_private.site_content c ON c.organisation_id=p.organisation_id
    WHERE p.active AND p.role='admin'
  LOOP
    -- No applicant personal data in lock-screen notifications. Existing push trigger handles delivery.
    PERFORM public.create_notification(recipient.id,recipient.organisation_id,
      'Ny intresseanmälan','En ny intresseanmälan har kommit in via Vibo Fastigheters hemsida.',
      'info','vibofast-interests/' || NEW.id::text,NULL);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION vihem_vibofast_private.notify_interest_admins() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_vihem_vibofast_interest_notification
  AFTER INSERT ON vihem_vibofast_private.enquiries
  FOR EACH ROW EXECUTE FUNCTION vihem_vibofast_private.notify_interest_admins();
NOTIFY pgrst,'reload schema';
COMMIT;
