-- Driftmeddelanden från Vibogruppen till anslutna kundsystem (t.ex. JK Projektlogistik).
-- Ett meddelande visas som banner i kundsystemet mellan show_from och show_until. Underhållsfönstret (event_*) är den tid
-- då själva uppdateringen/underhållet sker och är ren information. Meddelandet gäller alla kunder eller utvalda kunder.
-- Kundsystemen hämtar aktiva meddelanden server-till-server med sin API-nyckel (samma nyckel som för AI-tolkning).

CREATE TABLE IF NOT EXISTS vihem_vibogruppen_private.system_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  kind text NOT NULL DEFAULT 'maintenance' CHECK (kind IN ('update', 'maintenance', 'incident', 'other')),
  show_from timestamptz NOT NULL,
  show_until timestamptz NOT NULL,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  all_customers boolean NOT NULL DEFAULT true,
  customer_ids uuid[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (show_until > show_from),
  CHECK (event_ends_at IS NULL OR event_starts_at IS NULL OR event_ends_at >= event_starts_at),
  CHECK (all_customers OR cardinality(customer_ids) > 0)
);

CREATE INDEX IF NOT EXISTS idx_system_notices_window ON vihem_vibogruppen_private.system_notices (show_from, show_until) WHERE active;

REVOKE ALL ON vihem_vibogruppen_private.system_notices FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_notices_list()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'body', n.body, 'severity', n.severity, 'kind', n.kind,
      'show_from', n.show_from, 'show_until', n.show_until, 'event_starts_at', n.event_starts_at, 'event_ends_at', n.event_ends_at,
      'all_customers', n.all_customers, 'customer_ids', to_jsonb(n.customer_ids), 'active', n.active,
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
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Ogiltig post'; END IF;
  IF NOT v_all AND cardinality(v_customers) = 0 THEN RAISE EXCEPTION 'Välj minst en kund eller låt meddelandet gälla alla'; END IF;
  IF NOT v_all AND EXISTS (SELECT 1 FROM unnest(v_customers) AS u(cid) WHERE NOT EXISTS (SELECT 1 FROM vihem_vibogruppen_private.billing_customers c WHERE c.id = u.cid)) THEN
    RAISE EXCEPTION 'Kunden hittades inte';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO vihem_vibogruppen_private.system_notices (title, body, severity, kind, show_from, show_until, event_starts_at, event_ends_at, all_customers, customer_ids, active, created_by)
    VALUES (btrim(coalesce(p ->> 'title', '')), coalesce(p ->> 'body', ''), coalesce(p ->> 'severity', 'warning'), coalesce(p ->> 'kind', 'maintenance'),
      (p ->> 'show_from')::timestamptz, (p ->> 'show_until')::timestamptz, nullif(p ->> 'event_starts_at', '')::timestamptz, nullif(p ->> 'event_ends_at', '')::timestamptz,
      v_all, CASE WHEN v_all THEN '{}' ELSE v_customers END, coalesce((p ->> 'active')::boolean, true), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE vihem_vibogruppen_private.system_notices SET
      title = btrim(coalesce(p ->> 'title', title)), body = coalesce(p ->> 'body', body), severity = coalesce(p ->> 'severity', severity), kind = coalesce(p ->> 'kind', kind),
      show_from = coalesce((p ->> 'show_from')::timestamptz, show_from), show_until = coalesce((p ->> 'show_until')::timestamptz, show_until),
      event_starts_at = CASE WHEN p ? 'event_starts_at' THEN nullif(p ->> 'event_starts_at', '')::timestamptz ELSE event_starts_at END,
      event_ends_at = CASE WHEN p ? 'event_ends_at' THEN nullif(p ->> 'event_ends_at', '')::timestamptz ELSE event_ends_at END,
      all_customers = v_all, customer_ids = CASE WHEN v_all THEN '{}' ELSE v_customers END,
      active = coalesce((p ->> 'active')::boolean, active), updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Meddelandet hittades inte'; END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_notice_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  DELETE FROM vihem_vibogruppen_private.system_notices WHERE id = p_id;
END $$;

-- Aktiva meddelanden för ett kundsystem (endast service_role). Fungerar även om AI-tolkningen är avstängd för kunden.
CREATE OR REPLACE FUNCTION public.vihem_notices_for_client(p_key_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  c vihem_vibogruppen_private.ai_clients;
BEGIN
  SELECT * INTO c FROM vihem_vibogruppen_private.ai_clients WHERE key_hash = p_key_hash AND active;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ogiltig nyckel' USING ERRCODE = '28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vihem_vibogruppen_private.billing_customers WHERE id = c.customer_id AND active) THEN
    RAISE EXCEPTION 'Kunden är inaktiv' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'body', n.body, 'severity', n.severity, 'kind', n.kind,
      'show_from', n.show_from, 'show_until', n.show_until, 'event_starts_at', n.event_starts_at, 'event_ends_at', n.event_ends_at,
      'updated_at', n.updated_at
    ) ORDER BY CASE n.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, n.show_from DESC)
    FROM vihem_vibogruppen_private.system_notices n
    WHERE n.active AND now() >= n.show_from AND now() < n.show_until AND (n.all_customers OR c.customer_id = ANY (n.customer_ids))), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION
  public.vihem_vibogruppen_notices_list(), public.vihem_vibogruppen_notice_save(jsonb), public.vihem_vibogruppen_notice_delete(uuid), public.vihem_notices_for_client(text)
FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_vibogruppen_notices_list(), public.vihem_vibogruppen_notice_save(jsonb), public.vihem_vibogruppen_notice_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_notices_for_client(text) TO service_role;

NOTIFY pgrst, 'reload schema';
