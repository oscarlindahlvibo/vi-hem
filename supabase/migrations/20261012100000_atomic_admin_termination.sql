ALTER TABLE public.vihem_termination_requests ADD COLUMN IF NOT EXISTS registration_update_tenancy boolean;

-- Admin registration and tenancy termination must commit together.
CREATE OR REPLACE FUNCTION public.vihem_register_termination(
 p_request_id uuid, p_tenancy_id uuid, p_move_out_date date,
 p_new_address text, p_message text, p_internal_notes text,
 p_status text, p_update_tenancy boolean
) RETURNS public.vihem_termination_requests
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE actor public.vihem_profiles; tenancy public.vihem_tenancies; result public.vihem_termination_requests;
BEGIN
 SELECT * INTO actor FROM public.vihem_profiles WHERE id = auth.uid();
 IF actor.id IS NULL OR NOT actor.active OR actor.role NOT IN ('admin','superadmin') THEN RAISE EXCEPTION 'Inte behörig'; END IF;
 IF p_request_id IS NULL OR p_move_out_date IS NULL OR p_update_tenancy IS NULL OR p_status NOT IN ('received','processing','approved','closed') THEN RAISE EXCEPTION 'Ogiltiga uppgifter'; END IF;
 SELECT * INTO tenancy FROM public.vihem_tenancies WHERE id=p_tenancy_id AND organisation_id=actor.organisation_id FOR UPDATE;
 IF tenancy.id IS NULL THEN RAISE EXCEPTION 'Hyresförhållandet är inte tillgängligt'; END IF;
 SELECT * INTO result FROM public.vihem_termination_requests WHERE id=p_request_id;
 IF result.id IS NOT NULL THEN
   IF result.confirmed_by IS DISTINCT FROM actor.id OR result.tenancy_id IS DISTINCT FROM p_tenancy_id
      OR result.requested_move_out_date IS DISTINCT FROM p_move_out_date OR result.new_address IS DISTINCT FROM p_new_address
      OR result.message IS DISTINCT FROM p_message OR result.internal_notes IS DISTINCT FROM p_internal_notes
      OR result.registration_update_tenancy IS DISTINCT FROM p_update_tenancy
      OR result.status IS DISTINCT FROM p_status THEN RAISE EXCEPTION 'Begäran har redan sparats med andra uppgifter'; END IF;
   IF p_update_tenancy AND (tenancy.status <> 'terminated' OR tenancy.end_date IS DISTINCT FROM p_move_out_date) THEN RAISE EXCEPTION 'Hyresförhållandet har ändrats. Läs om ärendet'; END IF;
   RETURN result;
 END IF;
 IF tenancy.status <> 'active' THEN RAISE EXCEPTION 'Hyresförhållandet är inte längre aktivt'; END IF;
 INSERT INTO public.vihem_termination_requests(id,organisation_id,tenant_id,tenancy_id,requested_move_out_date,new_address,message,internal_notes,status,confirmed_by,confirmed_at,registration_update_tenancy)
 VALUES(p_request_id,actor.organisation_id,tenancy.tenant_id,tenancy.id,p_move_out_date,p_new_address,p_message,p_internal_notes,p_status,actor.id,now(),p_update_tenancy) RETURNING * INTO result;
 IF p_update_tenancy THEN
   UPDATE public.vihem_tenancies SET status='terminated',end_date=p_move_out_date WHERE id=tenancy.id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Hyresförhållandet kunde inte uppdateras'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.vihem_register_termination(uuid,uuid,date,text,text,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vihem_register_termination(uuid,uuid,date,text,text,text,text,boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
