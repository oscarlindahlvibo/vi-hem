BEGIN;
-- The existing BEFORE INSERT notification preference guard may return NULL.
-- Close that notice rather than retrying it forever and starving the queue.
DO $migration$
DECLARE definition text;
needle text:=E'   UPDATE vihem_snow_notices SET notification_id=target WHERE id=n.id;count_notices:=count_notices+1;';
replacement text:=E'   IF target IS NULL THEN\n    UPDATE vihem_snow_notices SET closed_at=clock_timestamp() WHERE id=n.id;\n    INSERT INTO vihem_snow_events(organisation_id,kind,object_id,details) VALUES(org,''notification_suppressed'',n.id,jsonb_build_object(''user_id'',n.user_id,''reason'',''existing_notification_guard''));\n   ELSE\n    UPDATE vihem_snow_notices SET notification_id=target WHERE id=n.id;count_notices:=count_notices+1;\n   END IF;';
BEGIN
 SELECT pg_get_functiondef('public.vihem_snow_dispatch()'::regprocedure) INTO definition;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Dispatch function changed; review before applying suppression fix';END IF;
 EXECUTE replace(definition,needle,replacement);
END$migration$;
COMMIT;
