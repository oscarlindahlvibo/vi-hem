-- Endast isolerad QA. Alla syntetiska ändringar rullas tillbaka.
begin;
create or replace function pg_temp.expect(p_name text,p_ok boolean) returns void language plpgsql as $$
begin if not coalesce(p_ok,false) then raise exception 'FAIL %',p_name; end if; raise notice 'PASS %',p_name; end $$;
create or replace function pg_temp.reject(p_name text,p_sql text,p_code text) returns void language plpgsql as $$
declare msg text; begin begin execute p_sql; exception when others then msg:=SQLERRM; end;
if msg is null or position(p_code in msg)=0 then raise exception 'FAIL %: %',p_name,coalesce(msg,'no rejection'); end if; raise notice 'PASS %',p_name; end $$;
select pg_temp.expect('anon cannot read private evidence',not has_table_privilege('anon','public.vihem_rental_bankid_orders','select'));
select pg_temp.expect('authenticated cannot read private evidence',not has_table_privilege('authenticated','public.vihem_rental_bankid_orders','select'));
select pg_temp.expect('anon cannot forge completion',not has_function_privilege('anon','public.vihem_rental_complete_bankid(text,uuid,uuid,text,text)','execute'));
select pg_temp.expect('authenticated cannot forge completion',not has_function_privilege('authenticated','public.vihem_rental_complete_bankid(text,uuid,uuid,text,text)','execute'));
do $$
declare org uuid; b uuid; ref text:='bankid-qa-'||gen_random_uuid(); evidence text:=repeat('synthetic-encrypted-evidence-',3); snap text;
begin
 select id into org from public.vihem_organisations limit 1;
 insert into public.vihem_rental_bookings(organisation_id,public_reference,status,start_at,end_at,hold_expires_at,contract_terms_snapshot,total)
 values(org,'QA-'||gen_random_uuid(),'pending',now()+interval '1 day',now()+interval '2 days',now()+interval '30 minutes','Syntetiskt hyresavtal',950) returning id into b;
 snap:=public.vihem_rental_signing_snapshot(b,org);
 insert into public.vihem_rental_bankid_orders(order_ref,organisation_id,booking_id,environment,booking_snapshot) values(ref,org,b,'test',snap);
 perform pg_temp.reject('wrong organisation',format('select public.vihem_rental_complete_bankid(%L,%L,%L,%L,%L)',ref,gen_random_uuid(),b,'QA Signer',evidence),'E_NOT_FOUND');
 perform pg_temp.reject('wrong booking',format('select public.vihem_rental_complete_bankid(%L,%L,%L,%L,%L)',ref,org,gen_random_uuid(),'QA Signer',evidence),'E_NOT_FOUND');
 perform pg_temp.reject('missing evidence',format('select public.vihem_rental_complete_bankid(%L,%L,%L,%L,%L)',ref,org,b,'QA Signer',''),'E_STATE');
 perform pg_temp.expect('failed completion rolled back', (select contract_status='pending_signature' from public.vihem_rental_bookings where id=b));
 update public.vihem_rental_bookings set total=951 where id=b;
 perform pg_temp.reject('changed price',format('select public.vihem_rental_complete_bankid(%L,%L,%L,%L,%L)',ref,org,b,'QA Signer',evidence),'E_STATE');
 update public.vihem_rental_bookings set total=950,start_at=start_at+interval '1 hour' where id=b;
 perform pg_temp.reject('changed period',format('select public.vihem_rental_complete_bankid(%L,%L,%L,%L,%L)',ref,org,b,'QA Signer',evidence),'E_STATE');
 update public.vihem_rental_bookings set start_at=start_at-interval '1 hour' where id=b;
 update public.vihem_rental_bankid_orders set expires_at=now()-interval '1 minute' where order_ref=ref;
 perform pg_temp.reject('expired order',format('select public.vihem_rental_complete_bankid(%L,%L,%L,%L,%L)',ref,org,b,'QA Signer',evidence),'E_STATE');
 update public.vihem_rental_bankid_orders set expires_at=now()+interval '5 minutes' where order_ref=ref;
 perform public.vihem_rental_complete_bankid(ref,org,b,'QA Signer',evidence);
 perform pg_temp.expect('booking signed atomically',(select contract_status='signed' and contract_signer_name='QA Signer' and contract_acceptance->>'method'='bankid' from public.vihem_rental_bookings where id=b));
 perform pg_temp.expect('evidence stored privately',(select status='complete' and consumed_at is not null and encrypted_evidence=evidence from public.vihem_rental_bankid_orders where order_ref=ref));
 perform public.vihem_rental_complete_bankid(ref,org,b,'Changed signer',repeat('different evidence',5));
 perform pg_temp.expect('idempotent completion preserves original signer',(select contract_signer_name='QA Signer' from public.vihem_rental_bookings where id=b));
 perform pg_temp.expect('idempotent completion preserves evidence',(select encrypted_evidence=evidence from public.vihem_rental_bankid_orders where order_ref=ref));
end $$;
rollback;
