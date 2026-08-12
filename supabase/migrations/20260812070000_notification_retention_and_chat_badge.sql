-- Keep the notification inbox short without mixing chat unread state into it.
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.vihem_notifications;
CREATE POLICY "Users can delete own notifications"
  ON public.vihem_notifications
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_vihem_notifications_user_created_at
  ON public.vihem_notifications(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.vihem_cleanup_old_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.vihem_notifications
  WHERE user_id = NEW.user_id
    AND created_at < now() - interval '2 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vihem_cleanup_old_notifications
  ON public.vihem_notifications;
CREATE TRIGGER trg_vihem_cleanup_old_notifications
  AFTER INSERT ON public.vihem_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.vihem_cleanup_old_notifications();
