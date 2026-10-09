-- Isolated QA only. Remove this trigger/function after verification.
DO $$ BEGIN IF current_database() <> 'vihem_chat_qa' THEN RAISE EXCEPTION 'QA only'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.qa_inspection_document_fail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.title='Controlled inspection protocol failure QA' THEN RAISE EXCEPTION 'Controlled QA document failure'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS qa_inspection_document_fail ON public.vihem_documents;
CREATE TRIGGER qa_inspection_document_fail BEFORE INSERT OR UPDATE ON public.vihem_documents FOR EACH ROW EXECUTE FUNCTION public.qa_inspection_document_fail();
CREATE OR REPLACE FUNCTION public.qa_inspection_finalize_fail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='completed' AND NEW.notes='Controlled finalization failure QA' THEN RAISE EXCEPTION 'Controlled QA finalization failure'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS qa_inspection_finalize_fail ON public.vihem_apartment_inspections;
CREATE TRIGGER qa_inspection_finalize_fail BEFORE INSERT OR UPDATE ON public.vihem_apartment_inspections FOR EACH ROW EXECUTE FUNCTION public.qa_inspection_finalize_fail();
