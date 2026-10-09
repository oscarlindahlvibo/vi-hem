-- Preserve inbox access, filters and pagination; describe an empty-body shared entity.
-- Only the preview changes. Stored message bodies and legal/business data are untouched.
BEGIN;
CREATE OR REPLACE FUNCTION public.vihem_chat_inbox(query text DEFAULT '', batch integer DEFAULT 100, offset_rows integer DEFAULT 0, thread_filter uuid DEFAULT NULL, filter_value text DEFAULT 'any') RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(row ORDER BY pinned DESC,last_message_at DESC,id),'[]'::jsonb) FROM (
 SELECT t.*,COALESCE(own.archived,false) AS archived,COALESCE(own.pinned,false) AS pinned,COALESCE(own.notification_mode,'all') AS notification_mode,
 COALESCE(own.manual_unread,false) AS manual_unread,
 (SELECT count(*) FROM public.vihem_chat_messages m WHERE m.thread_id=t.id AND m.sender_id<>auth.uid() AND m.created_at>COALESCE(own.last_read_at,'epoch'::timestamptz)) AS unread_count,
 (SELECT jsonb_build_object('id',m.id,'message',CASE WHEN m.deleted_at IS NOT NULL THEN 'Meddelandet har raderats' WHEN NULLIF(btrim(m.message),'') IS NOT NULL THEN m.message WHEN m.linked_work_order_id IS NOT NULL THEN 'Delad arbetsorder' WHEN m.linked_project_id IS NOT NULL THEN 'Delat projekt' ELSE m.message END,'sender_id',m.sender_id,'attachment_name',CASE WHEN m.deleted_at IS NULL THEN m.attachment_name END,'created_at',m.created_at) FROM public.vihem_chat_messages m WHERE m.thread_id=t.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS latest,
 public.vihem_chat_members(t.id) AS participants,
 (SELECT left(m.message,180) FROM public.vihem_chat_messages m WHERE m.thread_id=t.id AND m.deleted_at IS NULL AND query<>'' AND m.message ILIKE '%'||query||'%' ORDER BY m.created_at DESC LIMIT 1) AS search_excerpt
 FROM public.vihem_chat_threads t LEFT JOIN public.vihem_chat_participants own ON own.thread_id=t.id AND own.user_id=auth.uid() AND own.left_at IS NULL
 WHERE public.can_access_chat_thread(t.id) AND (thread_filter IS NULL OR t.id=thread_filter)
 AND (filter_value='any' OR (filter_value='archived' AND COALESCE(own.archived,false)) OR (NOT COALESCE(own.archived,false) AND (filter_value='all' OR (filter_value='staff' AND t.chat_type='direct') OR (filter_value='tenant' AND t.chat_type='tenant_support') OR (filter_value='group' AND t.chat_type='group') OR (filter_value='unread' AND (COALESCE(own.manual_unread,false) OR EXISTS(SELECT 1 FROM public.vihem_chat_messages m WHERE m.thread_id=t.id AND m.sender_id<>auth.uid() AND m.created_at>COALESCE(own.last_read_at,'epoch'::timestamptz)))))))
 AND (query='' OR t.subject ILIKE '%'||query||'%' OR EXISTS(SELECT 1 FROM jsonb_array_elements(public.vihem_chat_members(t.id)) member WHERE member->>'name' ILIKE '%'||query||'%') OR EXISTS(SELECT 1 FROM public.vihem_chat_messages m WHERE m.thread_id=t.id AND m.deleted_at IS NULL AND m.message ILIKE '%'||query||'%'))
 ORDER BY COALESCE(own.pinned,false) DESC,t.last_message_at DESC,t.id LIMIT least(greatest(batch,1),200) OFFSET greatest(offset_rows,0)
 ) row;
$$;

REVOKE ALL ON FUNCTION public.vihem_chat_inbox(text,integer,integer,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vihem_chat_inbox(text,integer,integer,uuid,text) TO authenticated;
COMMIT;
