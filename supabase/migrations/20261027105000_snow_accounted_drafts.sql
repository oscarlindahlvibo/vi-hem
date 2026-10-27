BEGIN;
ALTER TABLE public.vihem_snow_invoice_batches ADD COLUMN external_payload jsonb,ADD COLUMN external_context jsonb NOT NULL DEFAULT '{}';
DO $$DECLARE c record;n int:=0;BEGIN FOR c IN SELECT conname,pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='public.vihem_accounted_invoice_links'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%source_type%' LOOP
 IF c.def NOT LIKE '%rental_billing%' OR c.def NOT LIKE '%customer_project%' OR c.def NOT LIKE '%manual_charge%' THEN RAISE EXCEPTION 'Accounteds källtyper har ändrats; granska före installation';END IF;
 EXECUTE format('ALTER TABLE vihem_accounted_invoice_links DROP CONSTRAINT %I',c.conname);n:=n+1;
 END LOOP;IF n<>1 THEN RAISE EXCEPTION 'Oväntad källtypsconstraint';END IF;END$$;
ALTER TABLE public.vihem_accounted_invoice_links ADD CONSTRAINT snow_accounted_source_types CHECK(source_type IN ('rental_billing','customer_project','manual_charge','snow_billing'));
CREATE FUNCTION public.vihem_snow_invoice_claim(p_id uuid,p_attempt uuid,p_reconcile boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b vihem_snow_invoice_batches;BEGIN
 SELECT * INTO STRICT b FROM vihem_snow_invoice_batches WHERE id=p_id FOR UPDATE;
 IF b.state='draft_created' THEN RETURN to_jsonb(b);END IF;
 IF b.external_payload IS NOT NULL AND b.state IN ('uncertain','processing') AND (b.state='uncertain' OR b.lease_until<=clock_timestamp()) AND NOT p_reconcile THEN RAISE EXCEPTION 'Osäkert tidigare anrop: stäm av befintligt utkast i Accounted. Automatisk ny POST är spärrad.' USING ERRCODE='P0001';END IF;
 IF b.state='processing' AND b.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'Överföring pågår; försök igen senare' USING ERRCODE='40001';END IF;
 UPDATE vihem_snow_invoice_batches SET state='processing',attempt_id=p_attempt,lease_until=clock_timestamp()+interval '2 minutes',last_error=NULL WHERE id=p_id RETURNING * INTO b;RETURN to_jsonb(b);
END$$;
CREATE FUNCTION public.vihem_snow_invoice_payload(p_id uuid,p_attempt uuid,p_payload jsonb,p_context jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b vihem_snow_invoice_batches;BEGIN
 SELECT * INTO STRICT b FROM vihem_snow_invoice_batches WHERE id=p_id FOR UPDATE;
 IF b.attempt_id IS DISTINCT FROM p_attempt OR b.state<>'processing' THEN RAISE EXCEPTION 'Överföringen ägs av annat försök';END IF;
 IF b.external_payload IS NOT NULL THEN IF b.external_payload IS DISTINCT FROM p_payload OR b.external_context IS DISTINCT FROM p_context THEN RAISE EXCEPTION 'Låst extern payload får inte ändras';END IF;RETURN b.external_payload;END IF;
 UPDATE vihem_snow_invoice_batches SET external_payload=p_payload,external_context=p_context WHERE id=p_id;RETURN p_payload;
END$$;
CREATE FUNCTION public.vihem_snow_invoice_finish(p_id uuid,p_attempt uuid,p_company_link uuid,p_response jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b vihem_snow_invoice_batches;link_id uuid;BEGIN
 SELECT * INTO STRICT b FROM vihem_snow_invoice_batches WHERE id=p_id FOR UPDATE;
 IF b.state='draft_created' THEN RETURN;END IF;
 IF b.attempt_id IS DISTINCT FROM p_attempt OR b.state<>'processing' THEN RAISE EXCEPTION 'Överföringen ägs av annat försök';END IF;
 IF NOT EXISTS(SELECT 1 FROM vihem_accounted_company_links WHERE id=p_company_link AND organisation_id=b.organisation_id AND company_id=b.company_id) OR b.external_payload IS NULL OR p_response->>'customer_id' IS DISTINCT FROM b.external_payload->>'customer_id' OR position('VI-HEM snow batch '||b.id::text IN coalesce(p_response->>'notes',''))=0 OR p_response->>'invoice_date' IS DISTINCT FROM b.external_payload->>'invoice_date' OR p_response->>'due_date' IS DISTINCT FROM b.external_payload->>'due_date' OR p_response->>'status' IS DISTINCT FROM 'draft' OR coalesce(p_response->>'currency','SEK')<>'SEK' OR (p_response->>'id') IS NULL OR (p_response->>'id')!~'^[0-9a-fA-F-]{36}$' OR (p_response->>'total') IS NULL OR abs((p_response->>'total')::numeric-(b.snapshot->>'gross')::numeric)>0.02 OR ((b.snapshot->>'rut')::numeric>0 AND ((p_response->>'deduction_total') IS NULL OR abs((p_response->>'deduction_total')::numeric-(b.snapshot->>'rut')::numeric)>0.02)) THEN RAISE EXCEPTION 'Accounteds svar stämmer inte med underlaget. Manuell kontroll krävs.';END IF;
 INSERT INTO vihem_accounted_invoice_links(organisation_id,company_link_id,source_type,source_id,accounted_invoice_id,accounted_invoice_number,status,total,remaining_amount,invoice_date,due_date,created_by)
 VALUES(b.organisation_id,p_company_link,'snow_billing',b.id,p_response->>'id',p_response->>'invoice_number','draft',(p_response->>'total')::numeric,(p_response->>'remaining_amount')::numeric,(p_response->>'invoice_date')::date,(p_response->>'due_date')::date,b.created_by)
 ON CONFLICT(company_link_id,source_type,source_id) DO UPDATE SET last_synced_at=clock_timestamp() WHERE vihem_accounted_invoice_links.accounted_invoice_id=excluded.accounted_invoice_id RETURNING id INTO link_id;
 IF link_id IS NULL THEN RAISE EXCEPTION 'Befintlig fakturakoppling pekar på annat utkast';END IF;
 UPDATE vihem_snow_invoice_batches SET state='draft_created',accounted_invoice_id=p_response->>'id',accounted_link_id=link_id,lease_until=NULL,last_error=NULL WHERE id=b.id;
 INSERT INTO vihem_snow_events(organisation_id,actor_id,kind,object_id,details) VALUES(b.organisation_id,b.created_by,'accounted_draft_confirmed',b.id,jsonb_build_object('invoice_id',p_response->>'id'));
END$$;
CREATE FUNCTION public.vihem_snow_invoice_uncertain(p_id uuid,p_attempt uuid,p_error text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE vihem_snow_invoice_batches SET state='uncertain',lease_until=NULL,last_error=left(p_error,500) WHERE id=p_id AND attempt_id=p_attempt AND state='processing'
$$;
REVOKE ALL ON FUNCTION public.vihem_snow_invoice_claim(uuid,uuid,boolean),public.vihem_snow_invoice_payload(uuid,uuid,jsonb,jsonb),public.vihem_snow_invoice_finish(uuid,uuid,uuid,jsonb),public.vihem_snow_invoice_uncertain(uuid,uuid,text) FROM PUBLIC,authenticated,anon;
GRANT EXECUTE ON FUNCTION public.vihem_snow_invoice_claim(uuid,uuid,boolean),public.vihem_snow_invoice_payload(uuid,uuid,jsonb,jsonb),public.vihem_snow_invoice_finish(uuid,uuid,uuid,jsonb),public.vihem_snow_invoice_uncertain(uuid,uuid,text) TO service_role;
COMMIT;
