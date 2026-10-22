-- Driftmeddelanden även för Vibogruppens egna appar och sajter (VI-HEM, Kompetensportalen, Vibofast, Vibogruppen, ViboRent).
-- Ett meddelande kan nu rikta sig mot kundsystem (alla/utvalda/inga) och/eller egna ytor (surfaces). Sajterna är publika och
-- hämtar aktiva meddelanden för sin yta med vihem_public_notices (anon får anropa den; den lämnar bara ut bannertexten).

ALTER TABLE vihem_vibogruppen_private.system_notices ADD COLUMN IF NOT EXISTS surfaces text[] NOT NULL DEFAULT '{}';

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'vihem_vibogruppen_private.system_notices'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%all_customers OR%' LOOP
    EXECUTE format('ALTER TABLE vihem_vibogruppen_private.system_notices DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE vihem_vibogruppen_private.system_notices
  DROP CONSTRAINT IF EXISTS system_notices_surfaces_valid,
  DROP CONSTRAINT IF EXISTS system_notices_audience;
ALTER TABLE vihem_vibogruppen_private.system_notices
  ADD CONSTRAINT system_notices_surfaces_valid CHECK (surfaces <@ ARRAY['vihem-app', 'vihem-site', 'kompetensportalen', 'vibofast', 'vibogruppen', 'viborent']::text[]),
  ADD CONSTRAINT system_notices_audience CHECK (all_customers OR cardinality(customer_ids) > 0 OR cardinality(surfaces) > 0);

CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_notices_list()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'body', n.body, 'severity', n.severity, 'kind', n.kind,
      'show_from', n.show_from, 'show_until', n.show_until, 'event_starts_at', n.event_starts_at, 'event_ends_at', n.event_ends_at,
      'all_customers', n.all_customers, 'customer_ids', to_jsonb(n.customer_ids), 'surfaces', to_jsonb(n.surfaces), 'active', n.active,
      'live', n.active AND now() >= n.show_from AND now() < n.show_until,
      'customer_names', (SELECT coalesce(jsonb_agg(c.name ORDER BY c.name), '[]'::jsonb) FROM vihem_vibogruppen_private.billing_customers c WHERE c.id = ANY (n.customer_ids))
    ) ORDER BY n.show_until DESC, n.created_at DESC)
    FROM vihem_vibogruppen_private.system_notices n), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_notice_save(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_all boolean := coalesce((p ->> 'all_customers')::boolean, true);
  v_customers uuid[] := coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p -> 'customer_ids', '[]'::jsonb))::uuid), '{}');
  v_surfaces text[] := coalesce(ARRAY(SELECT DISTINCT jsonb_array_elements_text(coalesce(p -> 'surfaces', '[]'::jsonb))), '{}');
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Ogiltig post'; END IF;
  IF v_all THEN v_customers := '{}'; END IF;
  IF NOT v_all AND cardinality(v_customers) = 0 AND cardinality(v_surfaces) = 0 THEN RAISE EXCEPTION 'Välj minst en mottagare'; END IF;
  IF NOT v_surfaces <@ ARRAY['vihem-app', 'vihem-site', 'kompetensportalen', 'vibofast', 'vibogruppen', 'viborent']::text[] THEN RAISE EXCEPTION 'Okänd app eller sajt'; END IF;
  IF cardinality(v_customers) > 0 AND EXISTS (SELECT 1 FROM unnest(v_customers) AS u(cid) WHERE NOT EXISTS (SELECT 1 FROM vihem_vibogruppen_private.billing_customers c WHERE c.id = u.cid)) THEN
    RAISE EXCEPTION 'Kunden hittades inte';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO vihem_vibogruppen_private.system_notices (title, body, severity, kind, show_from, show_until, event_starts_at, event_ends_at, all_customers, customer_ids, surfaces, active, created_by)
    VALUES (btrim(coalesce(p ->> 'title', '')), coalesce(p ->> 'body', ''), coalesce(p ->> 'severity', 'warning'), coalesce(p ->> 'kind', 'maintenance'),
      (p ->> 'show_from')::timestamptz, (p ->> 'show_until')::timestamptz, nullif(p ->> 'event_starts_at', '')::timestamptz, nullif(p ->> 'event_ends_at', '')::timestamptz,
      v_all, v_customers, v_surfaces, coalesce((p ->> 'active')::boolean, true), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE vihem_vibogruppen_private.system_notices SET
      title = btrim(coalesce(p ->> 'title', title)), body = coalesce(p ->> 'body', body), severity = coalesce(p ->> 'severity', severity), kind = coalesce(p ->> 'kind', kind),
      show_from = coalesce((p ->> 'show_from')::timestamptz, show_from), show_until = coalesce((p ->> 'show_until')::timestamptz, show_until),
      event_starts_at = CASE WHEN p ? 'event_starts_at' THEN nullif(p ->> 'event_starts_at', '')::timestamptz ELSE event_starts_at END,
      event_ends_at = CASE WHEN p ? 'event_ends_at' THEN nullif(p ->> 'event_ends_at', '')::timestamptz ELSE event_ends_at END,
      all_customers = v_all, customer_ids = v_customers, surfaces = v_surfaces,
      active = coalesce((p ->> 'active')::boolean, active), updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Meddelandet hittades inte'; END IF;
  END IF;
  RETURN v_id;
END $$;

-- Publik läsning för Vibogruppens egna appar och sajter. Lämnar bara ut bannertexten, inga kunduppgifter.
CREATE OR REPLACE FUNCTION public.vihem_public_notices(p_surface text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_surface IS NULL OR p_surface NOT IN ('vihem-app', 'vihem-site', 'kompetensportalen', 'vibofast', 'vibogruppen', 'viborent') THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'body', n.body, 'severity', n.severity, 'kind', n.kind,
      'show_from', n.show_from, 'show_until', n.show_until, 'event_starts_at', n.event_starts_at, 'event_ends_at', n.event_ends_at,
      'updated_at', n.updated_at
    ) ORDER BY CASE n.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, n.show_from DESC)
    FROM vihem_vibogruppen_private.system_notices n
    WHERE n.active AND now() >= n.show_from AND now() < n.show_until AND p_surface = ANY (n.surfaces)), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.vihem_public_notices(text), public.vihem_vibogruppen_notices_list(), public.vihem_vibogruppen_notice_save(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_public_notices(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vihem_vibogruppen_notices_list(), public.vihem_vibogruppen_notice_save(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
