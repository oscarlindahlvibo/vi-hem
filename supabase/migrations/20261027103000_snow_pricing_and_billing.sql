BEGIN;
ALTER TABLE public.vihem_snow_clients ADD COLUMN rut_requested boolean NOT NULL DEFAULT false;
CREATE TABLE public.vihem_snow_prices(id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),client_id uuid REFERENCES public.vihem_snow_clients(id),activity text NOT NULL CHECK(activity IN ('snow_plowing','snow_sanding')),kind text NOT NULL CHECK(kind IN ('labor','machine','material','travel','start')),label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 200),mode text NOT NULL CHECK(mode IN ('hour','fixed','quantity')),amount numeric(14,4) NOT NULL CHECK(amount>=0),vat_rate numeric NOT NULL CHECK(vat_rate IN (0,6,12,25)),minimum_quantity numeric NOT NULL DEFAULT 0 CHECK(minimum_quantity>=0),round_minutes int NOT NULL DEFAULT 1 CHECK(round_minutes BETWEEN 1 AND 60),from_minutes int NOT NULL DEFAULT 0 CHECK(from_minutes>=0),to_minutes int CHECK(to_minutes>from_minutes),valid_from date NOT NULL,valid_until date,CHECK(valid_until IS NULL OR valid_until>=valid_from),rut_eligible boolean NOT NULL DEFAULT false CHECK(NOT rut_eligible OR kind='labor'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.vihem_snow_work_items(id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),entry_id uuid NOT NULL REFERENCES public.vihem_time_entries(id),price_id uuid NOT NULL REFERENCES public.vihem_snow_prices(id),quantity numeric(14,4) NOT NULL CHECK(quantity>0),comment text NOT NULL DEFAULT '');
CREATE TABLE public.vihem_snow_valuations(entry_id uuid PRIMARY KEY REFERENCES public.vihem_time_entries(id),organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),fingerprint text NOT NULL,lines jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.vihem_snow_customer_tax(customer_id uuid PRIMARY KEY REFERENCES public.vihem_finance_customers(id),organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),personnummer text NOT NULL DEFAULT '',housing text NOT NULL DEFAULT '',checked boolean NOT NULL DEFAULT false,updated_by uuid NOT NULL REFERENCES public.vihem_profiles(id));
CREATE TABLE public.vihem_snow_invoice_batches(id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id),company_id uuid NOT NULL REFERENCES public.vihem_companies(id),customer_id uuid NOT NULL REFERENCES public.vihem_finance_customers(id),period_from date NOT NULL,period_to date NOT NULL,reference text NOT NULL DEFAULT '',state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','processing','uncertain','draft_created','cancelled')),snapshot jsonb NOT NULL,accounted_invoice_id text,accounted_link_id uuid REFERENCES public.vihem_accounted_invoice_links(id),lease_until timestamptz,attempt_id uuid,last_error text,created_by uuid NOT NULL REFERENCES public.vihem_profiles(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(period_to>=period_from));
CREATE TABLE public.vihem_snow_invoice_entries(entry_id uuid PRIMARY KEY REFERENCES public.vihem_time_entries(id),batch_id uuid NOT NULL REFERENCES public.vihem_snow_invoice_batches(id),organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['vihem_snow_prices','vihem_snow_work_items','vihem_snow_valuations','vihem_snow_customer_tax','vihem_snow_invoice_batches','vihem_snow_invoice_entries'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY snow_billing_read ON public.%I FOR SELECT TO authenticated USING(organisation_id=vihem_get_my_org_id() AND vihem_snow_access() AND (vihem_snow_admin()%s))',t,CASE WHEN t='vihem_snow_prices' THEN ' OR true' WHEN t IN ('vihem_snow_work_items','vihem_snow_valuations') THEN ' OR EXISTS(SELECT 1 FROM vihem_time_entries e WHERE e.id=entry_id AND e.user_id=auth.uid())' ELSE '' END);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
END LOOP;END$$;
CREATE FUNCTION public.vihem_snow_price_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Prisversioner är oföränderliga. Skapa en ny version.';END IF;
 IF NEW.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vihem_snow_clients WHERE id=NEW.client_id AND organisation_id=NEW.organisation_id) THEN RAISE EXCEPTION 'Uppdraget tillhör annan organisation' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER snow_price_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.vihem_snow_prices FOR EACH ROW EXECUTE FUNCTION public.vihem_snow_price_guard();
CREATE FUNCTION public.vihem_snow_value_time(p_entry uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e vihem_time_entries;p vihem_snow_prices;lines jsonb:='[]';q numeric;day date;part text;item record;BEGIN
 SELECT * INTO e FROM vihem_time_entries WHERE id=p_entry AND snow_client_id IS NOT NULL AND status='approved' AND end_time IS NOT NULL FOR UPDATE;
 IF e.id IS NULL OR EXISTS(SELECT 1 FROM vihem_snow_valuations WHERE entry_id=e.id AND fingerprint=vihem_snow_time_fingerprint(e)) THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM vihem_snow_invoice_entries WHERE entry_id=e.id) THEN RAISE EXCEPTION 'Underlaget är låst';END IF;
 day:=(e.start_time AT TIME ZONE 'Europe/Stockholm')::date;
 FOREACH part IN ARRAY ARRAY['labor','machine','start'] LOOP
  IF part='machine' AND e.snow_method<>'machine' THEN CONTINUE;END IF;
  SELECT * INTO p FROM vihem_snow_prices WHERE organisation_id=e.organisation_id AND (client_id=e.snow_client_id OR client_id IS NULL) AND activity=e.category AND kind=part AND valid_from<=day AND (valid_until IS NULL OR valid_until>=day) AND e.total_minutes>from_minutes AND (to_minutes IS NULL OR e.total_minutes<=to_minutes)
  ORDER BY (client_id IS NOT NULL) DESC,valid_from DESC,created_at DESC,id LIMIT 1;
  IF p.id IS NULL THEN IF part='labor' OR (part='machine' AND e.snow_method='machine') THEN RETURN;ELSE CONTINUE;END IF;END IF;
  q:=CASE WHEN p.mode='fixed' THEN 1 WHEN p.mode='hour' THEN greatest(p.minimum_quantity,ceil(e.total_minutes::numeric/p.round_minutes)*p.round_minutes/60) ELSE NULL END;
  IF q IS NULL THEN RETURN;END IF;
  lines:=lines||jsonb_build_array(jsonb_build_object('price_id',p.id,'kind',part,'description',p.label,'quantity',q,'unit',CASE WHEN p.mode='hour' THEN 'tim' ELSE 'st' END,'unit_price',p.amount,'vat_rate',p.vat_rate,'net',round(q*p.amount,2),'vat',round(round(q*p.amount,2)*p.vat_rate/100,2),'rut_eligible',p.rut_eligible,'labor_hours',CASE WHEN part='labor' THEN e.total_minutes::numeric/60 ELSE 0 END));
 END LOOP;
 FOR item IN SELECT w.*,r.label,r.amount,r.vat_rate,r.kind,r.rut_eligible FROM vihem_snow_work_items w JOIN vihem_snow_prices r ON r.id=w.price_id WHERE w.entry_id=e.id LOOP
  lines:=lines||jsonb_build_array(jsonb_build_object('price_id',item.price_id,'kind',item.kind,'description',item.label,'quantity',item.quantity,'unit','st','unit_price',item.amount,'vat_rate',item.vat_rate,'net',round(item.quantity*item.amount,2),'vat',round(round(item.quantity*item.amount,2)*item.vat_rate/100,2),'rut_eligible',false,'labor_hours',0));
 END LOOP;
 INSERT INTO vihem_snow_valuations VALUES(e.id,e.organisation_id,vihem_snow_time_fingerprint(e),lines,clock_timestamp()) ON CONFLICT(entry_id) DO UPDATE SET fingerprint=excluded.fingerprint,lines=excluded.lines,created_at=excluded.created_at;
END$$;
-- Protect financial reservation even against old time-entry editing paths.
CREATE FUNCTION public.vihem_snow_financial_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$BEGIN
 IF EXISTS(SELECT 1 FROM vihem_snow_invoice_entries WHERE entry_id=OLD.id) THEN
  IF TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Passet ingår i låst fakturaunderlag. Spårbar korrigering krävs.';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END$$;
CREATE TRIGGER snow_financial_lock BEFORE UPDATE OR DELETE ON public.vihem_time_entries FOR EACH ROW EXECUTE FUNCTION public.vihem_snow_financial_lock();
CREATE FUNCTION public.vihem_snow_billing_command(p_id uuid,p_action text,p_data jsonb,p_org uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e vihem_time_entries;c vihem_snow_clients;customer vihem_finance_customers;tax vihem_snow_customer_tax;rows jsonb:='[]';line jsonb;item record;net numeric:=0;vat numeric:=0;deduction numeric:=0;price vihem_snow_prices;obj uuid;BEGIN
 IF NOT vihem_snow_admin() OR p_org<>vihem_get_my_org_id() OR p_actor<>auth.uid() THEN RAISE EXCEPTION 'Snöadministration krävs' USING ERRCODE='42501';END IF;
 IF p_action='review' THEN PERFORM vihem_snow_review_time((p_data->>'entry_id')::uuid,true,p_data->>'reason');RETURN '{}';END IF;
 IF p_action='invoice_release' THEN
  IF length(btrim(coalesce(p_data->>'reason','')))<4 THEN RAISE EXCEPTION 'Ange orsak för att återöppna underlaget';END IF;
  UPDATE vihem_snow_invoice_batches SET state='cancelled' WHERE id=(p_data->>'batch_id')::uuid AND organisation_id=p_org AND state='prepared' AND attempt_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Endast underlag som aldrig överförts får återöppnas. Extern rättelse görs i Accounted.';END IF;
  DELETE FROM vihem_snow_invoice_entries WHERE batch_id=(p_data->>'batch_id')::uuid AND organisation_id=p_org;RETURN '{}';
 END IF;
 IF p_action='customer_update' THEN
  obj:=(p_data->>'id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM vihem_finance_customers fc WHERE fc.id=obj AND fc.organisation_id=p_org AND md5(to_jsonb(fc)::text)=p_data->>'revision' FOR UPDATE) THEN RAISE EXCEPTION 'Kunduppgifterna har ändrats. Sök kunden igen.' USING ERRCODE='40001';END IF;
  UPDATE vihem_finance_customers SET name=btrim(p_data->>'name'),email=coalesce(p_data->>'email',''),phone=coalesce(p_data->>'phone',''),address_line1=coalesce(p_data->>'address',''),postal_code=coalesce(p_data->>'postal_code',''),city=coalesce(p_data->>'city','') WHERE id=obj AND organisation_id=p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kunden saknas' USING ERRCODE='42501';END IF;
  IF p_data ? 'personnummer' THEN
   IF coalesce((p_data->>'tax_checked')::boolean,false) AND (coalesce(p_data->>'personnummer','')!~'^[0-9]{12}$' OR length(btrim(p_data->>'housing'))<3) THEN RAISE EXCEPTION 'Kontrollera personnummer och bostadsuppgifter';END IF;
   INSERT INTO vihem_snow_customer_tax VALUES(obj,p_org,coalesce(p_data->>'personnummer',''),coalesce(p_data->>'housing',''),coalesce((p_data->>'tax_checked')::boolean,false),p_actor) ON CONFLICT(customer_id) DO UPDATE SET personnummer=excluded.personnummer,housing=excluded.housing,checked=excluded.checked,updated_by=p_actor;
  END IF;RETURN '{}';
 END IF;
 IF p_action='price' THEN
  IF (p_data->>'kind' IN ('labor','machine','start') AND p_data->>'mode' NOT IN ('hour','fixed')) OR (p_data->>'kind' IN ('material','travel') AND p_data->>'mode'<>'quantity') THEN RAISE EXCEPTION 'Arbete, maskin och startavgift kräver timpris eller fast pris; material och resa kräver enhetspris';END IF;
  INSERT INTO vihem_snow_prices(id,organisation_id,client_id,activity,kind,label,mode,amount,vat_rate,minimum_quantity,round_minutes,from_minutes,to_minutes,valid_from,valid_until,rut_eligible)
  VALUES(p_id,p_org,nullif(p_data->>'client_id','')::uuid,p_data->>'activity',p_data->>'kind',btrim(p_data->>'label'),p_data->>'mode',CASE WHEN coalesce((p_data->>'includes_vat')::boolean,false) THEN (p_data->>'amount')::numeric/(1+(p_data->>'vat_rate')::numeric/100) ELSE (p_data->>'amount')::numeric END,(p_data->>'vat_rate')::numeric,coalesce((p_data->>'minimum_quantity')::numeric,0),coalesce((p_data->>'round_minutes')::int,1),coalesce((p_data->>'from_minutes')::int,0),nullif(p_data->>'to_minutes','')::int,(p_data->>'valid_from')::date,nullif(p_data->>'valid_until','')::date,coalesce((p_data->>'rut_eligible')::boolean,false));RETURN jsonb_build_object('id',p_id);
 END IF;
 IF p_action<>'invoice_prepare' OR jsonb_typeof(p_data->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'entries') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Välj 1–500 godkända pass';END IF;
 FOR obj IN SELECT DISTINCT (value#>>'{}')::uuid FROM jsonb_array_elements(p_data->'entries') ORDER BY 1 LOOP
  SELECT * INTO e FROM vihem_time_entries WHERE id=obj AND organisation_id=p_org AND snow_client_id IS NOT NULL AND entry_type='work' AND end_time IS NOT NULL AND status='approved' FOR UPDATE;
  IF e.id IS NULL OR EXISTS(SELECT 1 FROM vihem_snow_invoice_entries WHERE entry_id=obj) THEN RAISE EXCEPTION 'Ett pass är inte godkänt eller redan reserverat';END IF;
  SELECT * INTO STRICT c FROM vihem_snow_clients WHERE id=e.snow_client_id;
  IF c.company_id IS NOT NULL AND NOT vihem_user_has_company_access(c.company_id,'seller') THEN RAISE EXCEPTION 'Säljbehörighet för bolaget krävs' USING ERRCODE='42501';END IF;
  IF c.finance_customer_id IS NULL OR c.company_id IS NULL THEN RAISE EXCEPTION 'Koppla uppdraget till juridisk kund och fakturerande bolag';END IF;
  IF customer.id IS NOT NULL AND (customer.id<>c.finance_customer_id OR (p_data->>'company_id')::uuid<>c.company_id OR coalesce(p_data->>'reference','')<>c.invoice_reference) THEN RAISE EXCEPTION 'Gruppera efter kund, bolag och fakturareferens';END IF;
  SELECT * INTO customer FROM vihem_finance_customers WHERE id=c.finance_customer_id AND organisation_id=p_org AND active;
  IF customer.id IS NULL OR btrim(customer.name)='' OR btrim(customer.address_line1)='' OR btrim(customer.postal_code)='' OR btrim(customer.city)='' THEN RAISE EXCEPTION 'Kundens faktureringsuppgifter måste kompletteras';END IF;
  IF (p_data->>'company_id')::uuid IS DISTINCT FROM c.company_id OR coalesce(p_data->>'reference','')<>c.invoice_reference THEN RAISE EXCEPTION 'Bolag eller referens stämmer inte';END IF;
  IF (e.start_time AT TIME ZONE 'Europe/Stockholm')::date NOT BETWEEN (p_data->>'from')::date AND (p_data->>'to')::date THEN RAISE EXCEPTION 'Passet ligger utanför vald period';END IF;
  -- Never silently reprice a historic valuation after price-list edits.
  IF NOT EXISTS(SELECT 1 FROM vihem_snow_valuations WHERE entry_id=e.id AND fingerprint=vihem_snow_time_fingerprint(e)) THEN RAISE EXCEPTION 'Passet saknar låst prisbild. Komplettera prislistan och granska passet.';END IF;
  FOR line IN SELECT value FROM jsonb_array_elements((SELECT lines FROM vihem_snow_valuations WHERE entry_id=e.id)) LOOP
   net:=net+(line->>'net')::numeric;vat:=vat+(line->>'vat')::numeric;
   IF c.rut_requested AND (line->>'rut_eligible')::boolean THEN
    SELECT * INTO tax FROM vihem_snow_customer_tax WHERE customer_id=customer.id AND organisation_id=p_org AND checked;
    IF customer.customer_type<>'private' OR tax.customer_id IS NULL THEN RAISE EXCEPTION 'RUT kräver granskad privatkund och skyddade person-/bostadsuppgifter';END IF;
    deduction:=deduction+round(((line->>'net')::numeric+(line->>'vat')::numeric)*0.5,2);
   END IF;
   rows:=rows||jsonb_build_array(line||jsonb_build_object('entry_id',e.id,'date',(e.start_time AT TIME ZONE 'Europe/Stockholm')::date,'assignment',c.name,'resource',(SELECT name FROM vihem_snow_resources WHERE id=e.snow_resource_id),'driver',(SELECT name FROM vihem_profiles WHERE id=e.user_id),'reference',c.invoice_reference,'cost_center',c.cost_center,'rut_requested',c.rut_requested));
  END LOOP;
 END LOOP;
 INSERT INTO vihem_snow_invoice_batches(id,organisation_id,company_id,customer_id,period_from,period_to,reference,snapshot,created_by)
 VALUES(p_id,p_org,(p_data->>'company_id')::uuid,customer.id,(p_data->>'from')::date,(p_data->>'to')::date,coalesce(p_data->>'reference',''),jsonb_build_object('customer',to_jsonb(customer),'lines',rows,'net',net,'vat',vat,'gross',net+vat,'rut',deduction,'customer_payable',net+vat-deduction,'invoice_date',(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date,'due_date',(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date+customer.payment_terms_days,'tax',CASE WHEN deduction>0 THEN to_jsonb(tax)-'updated_by' ELSE '{}' END),p_actor);
 INSERT INTO vihem_snow_invoice_entries SELECT DISTINCT (value#>>'{}')::uuid,p_id,p_org FROM jsonb_array_elements(p_data->'entries');
 RETURN jsonb_build_object('id',p_id,'net',net,'vat',vat,'gross',net+vat,'rut',deduction,'customer_payable',net+vat-deduction);
END$$;
-- Work items use their own small idempotent command, never client-supplied prices.
CREATE FUNCTION public.vihem_snow_add_item(p_id uuid,p_entry uuid,p_price uuid,p_quantity numeric,p_comment text DEFAULT '') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e vihem_time_entries;p vihem_snow_prices;old vihem_snow_work_items;BEGIN
 IF NOT vihem_snow_access() THEN RAISE EXCEPTION 'Åtkomst nekad' USING ERRCODE='42501';END IF;
 SELECT * INTO old FROM vihem_snow_work_items WHERE id=p_id;
 IF FOUND THEN IF old.organisation_id<>vihem_get_my_org_id() OR NOT EXISTS(SELECT 1 FROM vihem_time_entries WHERE id=old.entry_id AND user_id=auth.uid()) OR old.entry_id<>p_entry OR old.price_id<>p_price OR old.quantity<>p_quantity OR old.comment IS DISTINCT FROM left(p_comment,2000) THEN RAISE EXCEPTION 'Återförsöket har ändrats';END IF;RETURN;END IF;
 SELECT * INTO e FROM vihem_time_entries WHERE id=p_entry AND organisation_id=vihem_get_my_org_id() AND user_id=auth.uid() AND snow_client_id IS NOT NULL AND end_time IS NULL FOR UPDATE;
 SELECT * INTO p FROM vihem_snow_prices WHERE id=p_price AND organisation_id=vihem_get_my_org_id() AND (client_id IS NULL OR client_id=e.snow_client_id) AND activity=e.category AND kind IN ('material','travel') AND valid_from<=current_date AND (valid_until IS NULL OR valid_until>=current_date);
 IF e.id IS NULL OR p.id IS NULL OR p_quantity<=0 OR p_quantity>100000 THEN RAISE EXCEPTION 'Välj pågående pass, aktuell material-/reserad och antal';END IF;
 SELECT * INTO old FROM vihem_snow_work_items WHERE id=p_id;
 IF FOUND THEN IF old.entry_id<>p_entry OR old.price_id<>p_price OR old.quantity<>p_quantity OR old.comment<>p_comment THEN RAISE EXCEPTION 'Återförsöket har ändrats';END IF;RETURN;END IF;
 INSERT INTO vihem_snow_work_items VALUES(p_id,e.organisation_id,e.id,p.id,p_quantity,left(p_comment,2000));
END$$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('vihem_snow_price_guard','vihem_snow_value_time','vihem_snow_financial_lock','vihem_snow_billing_command','vihem_snow_add_item') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,authenticated,anon',f.sig);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION public.vihem_snow_add_item(uuid,uuid,uuid,numeric,text) TO authenticated;
COMMIT;
