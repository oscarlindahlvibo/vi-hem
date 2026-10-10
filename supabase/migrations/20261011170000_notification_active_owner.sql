-- Independent of premium features. Preserve owner-only permissive policies.
BEGIN;
CREATE POLICY "Notification active owner guard" ON public.vihem_notifications
AS RESTRICTIVE FOR ALL TO authenticated
USING (user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active))
WITH CHECK (user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active));
COMMIT;
