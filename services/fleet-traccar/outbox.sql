-- Run as the dedicated Traccar DB owner AFTER Traccar initializes tc_positions.
-- Role vihem_traccar_relay must already exist. No access to Supabase's postgres DB is required.
BEGIN;
LOCK TABLE tc_positions IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS vihem_outbox(
 id bigint PRIMARY KEY,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),last_error text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS vihem_outbox_pending ON vihem_outbox(next_attempt_at,id) WHERE delivered_at IS NULL;
CREATE OR REPLACE FUNCTION vihem_enqueue_position() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE imei text;model text;BEGIN
 SELECT uniqueid,tc_devices.model INTO imei,model FROM tc_devices WHERE id=NEW.deviceid;
 INSERT INTO vihem_outbox(id,payload) VALUES(NEW.id,jsonb_build_object('device',jsonb_build_object('uniqueId',imei,'model',model),'position',jsonb_build_object(
 'id',NEW.id,'protocol',NEW.protocol,'fixTime',to_char(NEW.fixtime,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'serverTime',to_char(NEW.servertime,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'valid',NEW.valid,'latitude',NEW.latitude,'longitude',NEW.longitude,
 'speed',NEW.speed,'course',NEW.course,'attributes',coalesce(nullif(NEW.attributes,''),'{}')::jsonb))) ON CONFLICT DO NOTHING;
 RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS vihem_outbox_position ON tc_positions;
CREATE TRIGGER vihem_outbox_position AFTER INSERT ON tc_positions FOR EACH ROW EXECUTE FUNCTION vihem_enqueue_position();
INSERT INTO vihem_outbox(id,payload) SELECT p.id,jsonb_build_object('device',jsonb_build_object('uniqueId',d.uniqueid,'model',d.model),'position',jsonb_build_object(
 'id',p.id,'protocol',p.protocol,'fixTime',to_char(p.fixtime,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'serverTime',to_char(p.servertime,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'valid',p.valid,'latitude',p.latitude,'longitude',p.longitude,
 'speed',p.speed,'course',p.course,'attributes',coalesce(nullif(p.attributes,''),'{}')::jsonb)) FROM tc_positions p JOIN tc_devices d ON d.id=p.deviceid ON CONFLICT DO NOTHING;
REVOKE ALL ON FUNCTION vihem_enqueue_position() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vihem_enqueue_position() TO vihem_traccar;
REVOKE ALL ON vihem_outbox FROM PUBLIC;
GRANT CONNECT ON DATABASE vihem_traccar TO vihem_traccar_relay;
GRANT USAGE ON SCHEMA public TO vihem_traccar_relay;
GRANT SELECT,UPDATE,DELETE ON vihem_outbox TO vihem_traccar_relay;
-- Bounded owner routine: acknowledged raw history only, never pending or current device positions.
CREATE OR REPLACE FUNCTION vihem_purge_traccar(p_days integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$BEGIN
 IF p_days NOT BETWEEN 7 AND 3650 THEN RAISE EXCEPTION 'Invalid retention';END IF;
 UPDATE tc_devices SET positionid=NULL WHERE positionid IN(SELECT p.id FROM tc_positions p JOIN vihem_outbox q ON q.id=p.id WHERE q.delivered_at IS NOT NULL AND p.servertime<now()-make_interval(days=>p_days));
 DELETE FROM tc_positions WHERE id IN (SELECT p.id FROM tc_positions p JOIN vihem_outbox q ON q.id=p.id WHERE q.delivered_at IS NOT NULL AND p.servertime<now()-make_interval(days=>p_days) AND NOT EXISTS(SELECT 1 FROM tc_devices d WHERE d.positionid=p.id) LIMIT 10000);
END$$;
REVOKE ALL ON FUNCTION vihem_purge_traccar(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vihem_purge_traccar(integer) TO vihem_traccar_relay;
COMMIT;
