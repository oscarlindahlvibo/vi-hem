-- Independent security correction. Existing org/module/admin policies still apply.
-- RESTRICTIVE is required: permissive policies combine with OR, including FOR ALL.
BEGIN;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'vihem\_fleet\_%' ESCAPE '\' LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Fleet active non-tenant read guard" ON public.%I',t.tablename);
    EXECUTE format('CREATE POLICY "Fleet active non-tenant read guard" ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active AND p.role IN (''staff'',''admin'',''superadmin'',''screen'')))',t.tablename);
  END LOOP;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vihem_inventory_stock_items','vihem_inventory_locations','vihem_inventory_balances','vihem_inventory_transactions','vihem_inventory_counts','vihem_inventory_count_lines'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Inventory active non-tenant read guard" ON public.%I',t);
    EXECUTE format('CREATE POLICY "Inventory active non-tenant read guard" ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.vihem_profiles p WHERE p.id=auth.uid() AND p.active AND p.role IN (''staff'',''admin'',''superadmin'',''screen'')))',t);
  END LOOP;
END $$;
COMMIT;
