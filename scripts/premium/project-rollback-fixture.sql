-- Apply only through the isolated QA SQL helper before project-integration.mjs.
DO $$ BEGIN IF current_database() <> 'vihem_chat_qa' THEN RAISE EXCEPTION 'QA only'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.qa_project_assignment_fail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.vihem_customer_projects WHERE id=NEW.project_id AND title='Atomic rollback QA') THEN RAISE EXCEPTION 'Controlled QA assignment failure'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS qa_project_assignment_fail ON public.vihem_project_assignments;
CREATE TRIGGER qa_project_assignment_fail BEFORE INSERT ON public.vihem_project_assignments FOR EACH ROW EXECUTE FUNCTION public.qa_project_assignment_fail();
