BEGIN;
-- Every writer, including older installed clients, invalidates stale editor snapshots.
CREATE FUNCTION public.vihem_editor_revision_timestamp()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.updated_at:=clock_timestamp();RETURN NEW;END $$;
REVOKE ALL ON FUNCTION public.vihem_editor_revision_timestamp() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER vihem_inventory_article_revision BEFORE UPDATE ON public.vihem_inventory_stock_items FOR EACH ROW EXECUTE FUNCTION public.vihem_editor_revision_timestamp();
CREATE TRIGGER vihem_schedule_entry_revision BEFORE UPDATE ON public.vihem_schedule_entries FOR EACH ROW EXECUTE FUNCTION public.vihem_editor_revision_timestamp();
COMMIT;
