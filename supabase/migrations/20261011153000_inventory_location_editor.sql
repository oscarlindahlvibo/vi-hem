BEGIN;
CREATE TABLE IF NOT EXISTS public.vihem_inventory_location_operations (
 actor_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE, operation_id uuid NOT NULL,
 organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id), location_id uuid NOT NULL REFERENCES public.vihem_inventory_locations(id) ON DELETE CASCADE,
 request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,operation_id)
);
ALTER TABLE public.vihem_inventory_location_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_inventory_location_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.vihem_inventory_location_operations TO service_role;
DROP TRIGGER IF EXISTS vihem_inventory_location_revision ON public.vihem_inventory_locations;
CREATE TRIGGER vihem_inventory_location_revision BEFORE UPDATE ON public.vihem_inventory_locations FOR EACH ROW EXECUTE FUNCTION public.vihem_editor_revision_timestamp();
-- Serialize a balance write with location archival, including older direct writers.
CREATE OR REPLACE FUNCTION public.vihem_inventory_balance_location_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM public.vihem_inventory_locations WHERE id=NEW.location_id AND organisation_id=NEW.organisation_id AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lagerplatsen är inte aktiv i organisationen.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.vihem_inventory_balance_location_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS vihem_inventory_balance_active_location ON public.vihem_inventory_balances;
CREATE TRIGGER vihem_inventory_balance_active_location BEFORE INSERT OR UPDATE ON public.vihem_inventory_balances FOR EACH ROW EXECUTE FUNCTION public.vihem_inventory_balance_location_guard();
CREATE OR REPLACE FUNCTION public.vihem_save_inventory_location(p_operation uuid,p_id uuid,p_revision timestamptz,p_name text,p_type text,p_parent uuid,p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; previous public.vihem_inventory_location_operations; target public.vihem_inventory_locations; result uuid; fingerprint text:=md5(jsonb_build_array(p_id,p_revision,p_name,p_type,p_parent,p_code)::text);
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role<>'admin' OR caller.organisation_id IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'Du saknar behörighet att hantera lagerplatser.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('inventory-locations:'||caller.organisation_id::text,0));
 SELECT * INTO previous FROM public.vihem_inventory_location_operations WHERE actor_id=caller.id AND operation_id=p_operation;
 IF FOUND THEN
  IF previous.organisation_id IS DISTINCT FROM caller.organisation_id THEN RAISE EXCEPTION 'Registreringen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
  IF previous.request_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Registreringen har ändrats.' USING ERRCODE='22023'; END IF;
  RETURN previous.location_id;
 END IF;
 IF nullif(btrim(p_name),'') IS NULL OR p_type IS NULL OR p_type NOT IN ('site','warehouse','room','vehicle','shelf','bin','other') THEN RAISE EXCEPTION 'Ange namn och typ.' USING ERRCODE='22023'; END IF;
 IF p_parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vihem_inventory_locations WHERE id=p_parent AND organisation_id=caller.organisation_id AND active) THEN RAISE EXCEPTION 'Välj en lagerplats i din organisation.' USING ERRCODE='42501'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO target FROM public.vihem_inventory_locations WHERE id=p_id AND organisation_id=caller.organisation_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lagerplatsen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
  IF p_revision IS DISTINCT FROM target.updated_at THEN RAISE EXCEPTION 'Lagerplatsen har ändrats. Öppna den igen innan du sparar.' USING ERRCODE='P0001'; END IF;
  IF EXISTS(WITH RECURSIVE descendants AS (SELECT id FROM public.vihem_inventory_locations WHERE id=p_id UNION SELECT l.id FROM public.vihem_inventory_locations l JOIN descendants d ON l.parent_location_id=d.id) SELECT 1 FROM descendants WHERE id=p_parent) THEN RAISE EXCEPTION 'En plats kan inte flyttas under sig själv eller en underplats.' USING ERRCODE='22023'; END IF;
  UPDATE public.vihem_inventory_locations SET name=btrim(p_name),type=p_type,parent_location_id=p_parent,code=coalesce(btrim(p_code),'') WHERE id=p_id RETURNING id INTO result;
 ELSE
  INSERT INTO public.vihem_inventory_locations(organisation_id,name,type,parent_location_id,code,created_by) VALUES(caller.organisation_id,btrim(p_name),p_type,p_parent,coalesce(btrim(p_code),''),caller.id) RETURNING id INTO result;
 END IF;
 INSERT INTO public.vihem_inventory_location_operations(actor_id,operation_id,organisation_id,location_id,request_hash) VALUES(caller.id,p_operation,caller.organisation_id,result,fingerprint);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.vihem_archive_inventory_location(p_id uuid,p_revision timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller public.vihem_profiles; target public.vihem_inventory_locations;
BEGIN
 SELECT * INTO caller FROM public.vihem_profiles WHERE id=auth.uid();
 IF caller.id IS NULL OR NOT caller.active OR caller.role<>'admin' OR caller.organisation_id IS NULL THEN RAISE EXCEPTION 'Du saknar behörighet.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('inventory-locations:'||caller.organisation_id::text,0));
 SELECT * INTO target FROM public.vihem_inventory_locations WHERE id=p_id AND organisation_id=caller.organisation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lagerplatsen är inte tillgänglig.' USING ERRCODE='42501'; END IF;
 IF NOT target.active THEN RETURN; END IF;
 IF target.updated_at IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Lagerplatsen har ändrats. Öppna den igen.' USING ERRCODE='P0001'; END IF;
 IF EXISTS(SELECT 1 FROM public.vihem_inventory_balances WHERE location_id=p_id AND quantity<>0) OR EXISTS(SELECT 1 FROM public.vihem_inventory_locations WHERE parent_location_id=p_id AND active) THEN RAISE EXCEPTION 'Flytta saldot och arkivera underplatserna först.' USING ERRCODE='P0001'; END IF;
 UPDATE public.vihem_inventory_locations SET active=false WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.vihem_save_inventory_location(uuid,uuid,timestamptz,text,text,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.vihem_archive_inventory_location(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vihem_save_inventory_location(uuid,uuid,timestamptz,text,text,uuid,text),public.vihem_archive_inventory_location(uuid,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
