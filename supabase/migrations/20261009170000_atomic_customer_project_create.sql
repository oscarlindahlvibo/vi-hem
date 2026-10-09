-- Additive, invoker-security RPC: existing RLS remains authoritative.
-- Project, participants and initial history commit together. A stable client
-- id makes retries after a lost HTTP response return the original project.
CREATE OR REPLACE FUNCTION public.vihem_create_customer_project(p_id uuid, p_form jsonb, p_assigned uuid[] DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  actor public.vihem_profiles%ROWTYPE;
  customer public.vihem_project_customers%ROWTYPE;
  manager uuid := nullif(p_form->>'project_manager_id','')::uuid;
  participant uuid;
  old_project public.vihem_customer_projects%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.vihem_profiles WHERE id = auth.uid() AND active;
  IF actor.id IS NULL OR actor.organisation_id IS NULL OR actor.role NOT IN ('admin','superadmin') THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR length(btrim(coalesce(p_form->>'title',''))) = 0 THEN
    RAISE EXCEPTION 'Ange projektnamn.' USING ERRCODE = '22023';
  END IF;
  -- Serialise concurrent retries of the same client id before inspecting it.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  SELECT * INTO old_project FROM public.vihem_customer_projects WHERE id = p_id;
  IF FOUND THEN
    IF old_project.created_by IS DISTINCT FROM actor.id OR old_project.organisation_id IS DISTINCT FROM actor.organisation_id THEN
      RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
    END IF;
    RETURN p_id;
  END IF;
  SELECT * INTO customer FROM public.vihem_project_customers
    WHERE id = nullif(p_form->>'customer_id','')::uuid AND organisation_id = actor.organisation_id;
  IF customer.id IS NULL THEN RAISE EXCEPTION 'Välj en kund i organisationen.' USING ERRCODE = '22023'; END IF;
  IF nullif(p_form->>'planned_end_date','')::date < nullif(p_form->>'start_date','')::date THEN
    RAISE EXCEPTION 'Slutdatum får inte vara före startdatum.' USING ERRCODE = '22023';
  END IF;
  FOR participant IN SELECT DISTINCT unnest(coalesce(p_assigned,'{}') || ARRAY[manager]) LOOP
    IF participant IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.vihem_profiles WHERE id=participant AND organisation_id=actor.organisation_id AND active AND role IN ('staff','admin','superadmin')
    ) THEN RAISE EXCEPTION 'Ogiltig deltagare.' USING ERRCODE = '42501'; END IF;
  END LOOP;
  INSERT INTO public.vihem_customer_projects (
    id,organisation_id,customer_id,customer_name,name,title,description,project_address,project_type,priority,billing_type,project_manager_id,
    start_date,planned_end_date,budget_amount,hourly_rate,internal_reference,external_reference,status,created_by
  ) VALUES (
    p_id,actor.organisation_id,customer.id,customer.name,p_form->>'title',p_form->>'title',coalesce(p_form->>'description',''),
    coalesce(nullif(p_form->>'project_address',''),customer.project_address,''),p_form->>'project_type',p_form->>'priority',p_form->>'billing_type',manager,
    nullif(p_form->>'start_date','')::date,nullif(p_form->>'planned_end_date','')::date,
    coalesce(nullif(p_form->>'budget_amount','')::numeric,0),coalesce(nullif(p_form->>'hourly_rate','')::numeric,0),
    coalesce(p_form->>'internal_reference',''),coalesce(p_form->>'external_reference',''),'draft',actor.id
  );
  INSERT INTO public.vihem_project_assignments(project_id,user_id,role)
    SELECT p_id,id,CASE WHEN id=manager THEN 'project_manager' ELSE 'staff' END
    FROM (SELECT DISTINCT unnest(coalesce(p_assigned,'{}') || ARRAY[manager]) id) selected WHERE id IS NOT NULL;
  INSERT INTO public.vihem_project_activity_log(project_id,organisation_id,user_id,event_type,description)
    VALUES (p_id,actor.organisation_id,actor.id,'project_created','Projektet skapades.');
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.vihem_create_customer_project(uuid,jsonb,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vihem_create_customer_project(uuid,jsonb,uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
