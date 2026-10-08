BEGIN;
-- Copy only a file explicitly approved by staff; never expose the source conversation.
CREATE TABLE public.vihem_chat_workorder_files(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),
 work_order_id uuid NOT NULL REFERENCES public.vihem_work_orders(id) ON DELETE CASCADE,
 source_message_id uuid NOT NULL REFERENCES public.vihem_chat_messages(id),
 path text NOT NULL UNIQUE, name text NOT NULL,mime text,size bigint NOT NULL,
 created_by uuid NOT NULL REFERENCES public.vihem_profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(work_order_id,source_message_id)
);
ALTER TABLE public.vihem_chat_workorder_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vihem_chat_workorder_files FROM anon,authenticated;
GRANT SELECT ON public.vihem_chat_workorder_files TO authenticated;
GRANT ALL ON public.vihem_chat_workorder_files TO service_role;
CREATE POLICY work_order_read ON public.vihem_chat_workorder_files FOR SELECT TO authenticated USING(
 organisation_id=public.vihem_get_my_org_id() AND EXISTS(SELECT 1 FROM public.vihem_work_orders w WHERE w.id=work_order_id AND w.organisation_id=public.vihem_get_my_org_id())
);
CREATE POLICY service_all ON public.vihem_chat_workorder_files FOR ALL TO service_role USING(true) WITH CHECK(true);
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('vihem-chat-workorder-private','vihem-chat-workorder-private',false,52428800);
CREATE POLICY chat_workorder_file_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='vihem-chat-workorder-private' AND EXISTS(SELECT 1 FROM public.vihem_chat_workorder_files f WHERE f.path=objects.name));
CREATE POLICY chat_workorder_file_service ON storage.objects FOR ALL TO service_role USING(bucket_id='vihem-chat-workorder-private') WITH CHECK(bucket_id='vihem-chat-workorder-private');
NOTIFY pgrst,'reload schema';
COMMIT;
