BEGIN;
CREATE TABLE IF NOT EXISTS vihem_vibogruppen_private.charging_cache (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), snapshot jsonb,
 expires_at timestamptz, lease_id uuid, lease_until timestamptz
);
ALTER TABLE vihem_vibogruppen_private.charging_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vihem_vibogruppen_private.charging_cache FROM PUBLIC,anon,authenticated;
INSERT INTO vihem_vibogruppen_private.charging_cache(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_charging_claim(p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r vihem_vibogruppen_private.charging_cache%ROWTYPE;
BEGIN
 SELECT * INTO r FROM vihem_vibogruppen_private.charging_cache WHERE id FOR UPDATE;
 IF r.expires_at>clock_timestamp() THEN RETURN jsonb_build_object('snapshot',r.snapshot,'claimed',false); END IF;
 IF r.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('claimed',false); END IF;
 UPDATE vihem_vibogruppen_private.charging_cache SET lease_id=p_lease,lease_until=clock_timestamp()+interval '45 seconds' WHERE id;
 RETURN jsonb_build_object('claimed',true);
END $$;
CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_charging_store(p_lease uuid,p_snapshot jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_snapshot->>'status' NOT IN ('ok','unavailable') OR jsonb_typeof(p_snapshot->'points') IS DISTINCT FROM 'array' OR pg_column_size(p_snapshot)>16000 THEN RAISE EXCEPTION 'Invalid status'; END IF;
 UPDATE vihem_vibogruppen_private.charging_cache SET snapshot=p_snapshot,
 expires_at=clock_timestamp()+CASE WHEN p_snapshot->>'status'='ok' THEN interval '60 seconds' ELSE interval '30 seconds' END,
 lease_id=null,lease_until=null WHERE id AND lease_id=p_lease AND lease_until>clock_timestamp();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.vihem_vibogruppen_charging_claim(uuid),public.vihem_vibogruppen_charging_store(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vihem_vibogruppen_charging_claim(uuid),public.vihem_vibogruppen_charging_store(uuid,jsonb) TO service_role;
COMMIT;
