-- Existing staff-role policies are permissive and omit the parent organisation.
-- Restrict them without replacing business permissions or changing any data.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.vihem_work_order_comments'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'Work-order comments must already have RLS enabled';
  END IF;
END $$;
DROP POLICY IF EXISTS vihem_comment_parent_access ON public.vihem_work_order_comments;
CREATE POLICY vihem_comment_parent_access ON public.vihem_work_order_comments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('staff','admin','superadmin')
    AND EXISTS (SELECT 1 FROM public.vihem_profiles p WHERE p.id = auth.uid() AND p.active)
    -- This subquery obeys the existing work-order RLS, including explicitly
    -- permitted superadmin access. Membership in a chat grants no new access.
    AND EXISTS (SELECT 1 FROM public.vihem_work_orders w WHERE w.id = work_order_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.get_my_role() IN ('staff','admin','superadmin')
    AND EXISTS (SELECT 1 FROM public.vihem_profiles p WHERE p.id = auth.uid() AND p.active)
    AND EXISTS (SELECT 1 FROM public.vihem_work_orders w WHERE w.id = work_order_id)
  );
DROP POLICY IF EXISTS vihem_comment_no_anonymous_access ON public.vihem_work_order_comments;
CREATE POLICY vihem_comment_no_anonymous_access ON public.vihem_work_order_comments
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
COMMIT;
