-- BankID för ViboRent: privata sessionsbevis, atomisk signering av exakt bokningsögonblicksbild.
begin;
create table if not exists public.vihem_rental_bankid_orders (
 order_ref text primary key,
 organisation_id uuid not null references public.vihem_organisations(id),
 booking_id uuid not null references public.vihem_rental_bookings(id),
 environment text not null check(environment in ('test','production')),
 booking_snapshot text not null,
 status text not null default 'pending' check(status in ('pending','complete','failed')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '5 minutes',
 consumed_at timestamptz,
 encrypted_evidence text
);
alter table public.vihem_rental_bankid_orders enable row level security;
revoke all on public.vihem_rental_bankid_orders from public,anon,authenticated;
grant select,insert,update on public.vihem_rental_bankid_orders to service_role;
create index if not exists vihem_rental_bankid_booking on public.vihem_rental_bankid_orders(booking_id,created_at desc);

-- Snapshot är serverbestämd: avtal, belopp och varje hyrd rad. Ändrade tider/antal/priser kan inte signeras av en gammal order.
create or replace function public.vihem_rental_signing_snapshot(p_booking uuid,p_org uuid) returns text
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('booking',b.id,'organisation',b.organisation_id,'reference',b.public_reference,
 'contract',b.contract_terms_snapshot,'version',b.contract_terms_version,'version_id',b.contract_terms_version_id,
 'start',b.start_at,'end',b.end_at,'total',b.total,'currency',b.currency,'deposit',b.deposit,'customer',b.customer_id,
 'items',coalesce((select jsonb_agg(jsonb_build_object('product',i.product_id,'asset',i.asset_id,'quantity',i.quantity,'start',i.start_at,'end',i.end_at) order by i.id)
 from public.vihem_rental_booking_items i where i.booking_id=b.id),'[]'::jsonb))::text
 from public.vihem_rental_bookings b where b.id=p_booking and b.organisation_id=p_org;
$$;
revoke all on function public.vihem_rental_signing_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.vihem_rental_signing_snapshot(uuid,uuid) to service_role;

create or replace function public.vihem_rental_complete_bankid(p_ref text,p_org uuid,p_booking uuid,p_name text,p_evidence text) returns void
language plpgsql security definer set search_path=public as $$
declare o public.vihem_rental_bankid_orders%rowtype; b public.vihem_rental_bookings%rowtype;
begin
 -- Lås bokningen före ordern, samma ordning även vid samtidiga återförsök.
 select * into b from public.vihem_rental_bookings where id=p_booking and organisation_id=p_org for update;
 if b.id is null then raise exception '[E_NOT_FOUND] Bokningen hittades inte.'; end if;
 select * into o from public.vihem_rental_bankid_orders where order_ref=p_ref and booking_id=b.id and organisation_id=p_org for update;
 if o.order_ref is null then raise exception '[E_NOT_FOUND] Signeringen hittades inte.'; end if;
 if o.consumed_at is not null and o.status='complete' then return; end if;
 if o.status<>'pending' or o.expires_at<now() then raise exception '[E_STATE] BankID-sessionen har gått ut.'; end if;
 if b.status<>'pending' or b.payment_status='paid' or b.contract_status<>'pending_signature' or (b.hold_expires_at is not null and b.hold_expires_at<now()) then raise exception '[E_STATE] Reservationen kan inte längre signeras.'; end if;
 if public.vihem_rental_signing_snapshot(b.id,p_org) is distinct from o.booking_snapshot then raise exception '[E_STATE] Bokningen har ändrats. Starta en ny signering.'; end if;
 if length(trim(p_name))<1 or length(p_evidence)<40 then raise exception '[E_STATE] Signeringsbevis saknas.'; end if;
 update public.vihem_rental_bookings set contract_status='signed',contract_signed_at=now(),contract_signer_name=p_name,
 contract_acceptance=jsonb_build_object('method','bankid','order_ref',p_ref,'accepted_at',now(),'terms_version',b.contract_terms_version),updated_at=now()
 where id=b.id;
 update public.vihem_rental_bankid_orders set status='complete',consumed_at=now(),encrypted_evidence=p_evidence where order_ref=p_ref;
end;
$$;
revoke all on function public.vihem_rental_complete_bankid(text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.vihem_rental_complete_bankid(text,uuid,uuid,text,text) to service_role;
commit;
