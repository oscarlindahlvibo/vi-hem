-- Three tester-reported chat gaps:
--
-- 1. Notification opened the chat LIST, not the specific thread -- the
--    trigger below only ever set notification_link to the literal string
--    'chat', matching the gap this migration's own predecessor
--    (20260831090000_notification_links_to_specific_records.sql) already
--    flagged but deliberately left alone ("chat... still link to their
--    list page -- those pages have no deep-link-to-one-record support
--    yet"). ChatPage.tsx now has that support (see app code), so this
--    closes the loop.
-- 2. No per-user unread state existed at all -- the only read tracking
--    was a message-level read_at column that gets blanket-updated by
--    whichever participant opens the thread first, which is meaningless
--    for a 3+-person group chat. vihem_chat_participants (one row per
--    thread per user) is exactly where per-user "have I seen this
--    thread's latest message" belongs.
-- 3. No image attachments -- vihem_chat_messages had nowhere to put one.

CREATE OR REPLACE FUNCTION public.notify_chat_message_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  thread_org uuid;
  participant_record record;
BEGIN
  SELECT organisation_id INTO thread_org
  FROM public.vihem_chat_threads
  WHERE id = NEW.thread_id;

  FOR participant_record IN
    SELECT user_id FROM public.vihem_chat_participants
    WHERE thread_id = NEW.thread_id
      AND user_id <> NEW.sender_id
  LOOP
    PERFORM public.create_notification(
      participant_record.user_id,
      thread_org,
      'Nytt chattmeddelande',
      LEFT(NEW.message, 120),
      'chat',
      'chat/' || NEW.thread_id,
      'chat_message'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

ALTER TABLE public.vihem_chat_participants ADD COLUMN IF NOT EXISTS last_read_at timestamptz;

ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS attachment_type text;
ALTER TABLE public.vihem_chat_messages ADD COLUMN IF NOT EXISTS attachment_name text;

-- Public-read bucket, same shape as vihem-work-order-attachments -- but
-- INSERT is open to any authenticated user (not staff-only), since
-- tenants are chat participants too (e.g. photographing a broken
-- faucet in a support thread).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vihem-chat-attachments',
  'vihem-chat-attachments',
  true,
  15728640,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "VIHEM authenticated can upload chat attachments" ON storage.objects;
CREATE POLICY "VIHEM authenticated can upload chat attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'vihem-chat-attachments');

DROP POLICY IF EXISTS "VIHEM public can view chat attachments" ON storage.objects;
CREATE POLICY "VIHEM public can view chat attachments"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'vihem-chat-attachments');

NOTIFY pgrst, 'reload schema';
