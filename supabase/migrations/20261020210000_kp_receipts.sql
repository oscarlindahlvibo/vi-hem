-- Kvitton för kortbetalningar (och kreditkvitton vid återbetalning). Ett kvitto är ett oföränderligt underlag med säljar- och radsnapshot,
-- ett löpnummer, och en PDF i privat lagring. Kvitton visas för köparen (och företagets administratör) i portalen och för personal i VI-HEM.
begin;

create sequence if not exists public.vihem_kp_receipt_seq;
create table if not exists public.vihem_kp_receipts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  order_id uuid not null references public.vihem_kp_orders(id),
  payment_id uuid references public.vihem_kp_payments(id),
  refund_id uuid references public.vihem_kp_refunds(id),
  kind text not null default 'receipt' check (kind in ('receipt', 'credit_receipt')),
  receipt_number text not null,
  issued_at timestamptz not null default now(),
  currency text not null default 'SEK',
  net_total numeric(12,2) not null,
  vat_total numeric(12,2) not null,
  total numeric(12,2) not null,
  payment_method text not null default 'stripe',
  payment_reference text,
  buyer_name text not null default '',
  buyer_email text not null default '',
  buyer_org_number text not null default '',
  billing jsonb not null default '{}'::jsonb,
  seller jsonb not null default '{}'::jsonb,
  lines jsonb not null default '[]'::jsonb,
  pdf_path text,
  pdf_sha256 text,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, receipt_number),
  check ((kind = 'receipt' and payment_id is not null and refund_id is null) or (kind = 'credit_receipt' and refund_id is not null))
);
create unique index if not exists vihem_kp_receipts_payment on public.vihem_kp_receipts (payment_id) where payment_id is not null;
create unique index if not exists vihem_kp_receipts_refund on public.vihem_kp_receipts (refund_id) where refund_id is not null;
create index if not exists vihem_kp_receipts_order on public.vihem_kp_receipts (order_id);
alter table public.vihem_kp_receipts enable row level security;
revoke all on public.vihem_kp_receipts from anon, authenticated;
grant select on public.vihem_kp_receipts to authenticated;
drop policy if exists vihem_kp_receipts_staff_select on public.vihem_kp_receipts;
create policy vihem_kp_receipts_staff_select on public.vihem_kp_receipts for select to authenticated using (public.vihem_kp_is_staff(organisation_id));

-- Skapar kvitto (idempotent per betalning/återbetalning). Returnerar kvittots id.
create or replace function public.vihem_kp_issue_receipt(p_order uuid, p_payment uuid default null, p_refund uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.vihem_kp_orders%rowtype; s public.vihem_kp_settings%rowtype; v_id uuid; v_kind text; v_total numeric(12,2); v_vat numeric(12,2); v_net numeric(12,2); v_ref text; v_lines jsonb; v_name text; v_orgnr text; v_ratio numeric;
begin
  if (p_payment is null) = (p_refund is null) then raise exception '[E_INVALID] Ange antingen betalning eller återbetalning.'; end if;
  select * into o from public.vihem_kp_orders where id = p_order;
  if o.id is null then raise exception '[E_NOT_FOUND] Ordern finns inte.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kp-receipt:' || coalesce(p_payment::text, p_refund::text), 0));
  select id into v_id from public.vihem_kp_receipts where (p_payment is not null and payment_id = p_payment) or (p_refund is not null and refund_id = p_refund);
  if v_id is not null then return v_id; end if;
  select * into s from public.vihem_kp_settings where organisation_id = o.organisation_id;
  if p_payment is not null then
    select amount, provider_ref into v_total, v_ref from public.vihem_kp_payments where id = p_payment and order_id = p_order and status = 'succeeded';
    if v_total is null then raise exception '[E_STATE] Betalningen är inte genomförd.'; end if;
    v_kind := 'receipt';
  else
    select amount, provider_ref into v_total, v_ref from public.vihem_kp_refunds where id = p_refund and order_id = p_order;
    if v_total is null then raise exception '[E_NOT_FOUND] Återbetalningen finns inte.'; end if;
    v_kind := 'credit_receipt';
  end if;
  v_ratio := case when o.total > 0 then v_total / o.total else 1 end;
  v_vat := round(o.vat_total * v_ratio, 2); v_net := v_total - v_vat;
  select coalesce(jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity, 'unit_price', unit_price, 'discount', discount, 'net_total', net_total, 'vat_rate', vat_rate, 'vat_amount', vat_amount, 'line_total', line_total) order by id), '[]'::jsonb) into v_lines from public.vihem_kp_order_items where order_id = p_order;
  select coalesce(nullif(trim(first_name || ' ' || last_name), ''), o.contact_email) into v_name from public.vihem_kp_participants where user_id = o.buyer_user_id;
  v_name := coalesce(nullif(o.billing ->> 'name', ''), nullif(o.billing ->> 'company', ''), v_name, o.contact_email);
  v_orgnr := coalesce(o.billing ->> 'org_number', '');
  insert into public.vihem_kp_receipts (organisation_id, order_id, payment_id, refund_id, kind, receipt_number, currency, net_total, vat_total, total, payment_method, payment_reference, buyer_name, buyer_email, buyer_org_number, billing, seller, lines)
    values (o.organisation_id, p_order, p_payment, p_refund, v_kind, (case when v_kind = 'receipt' then 'KV-' else 'KK-' end) || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.vihem_kp_receipt_seq')::text, 6, '0'), o.currency, v_net, v_vat, v_total, o.payment_method, v_ref, coalesce(v_name, ''), o.contact_email, v_orgnr, o.billing,
      jsonb_build_object('name', s.seller_name, 'org_number', s.seller_org_number, 'vat_number', s.seller_vat_number, 'address', s.seller_address, 'email', coalesce(nullif(s.support_email, ''), s.seller_email), 'phone', s.seller_phone), v_lines)
    returning id into v_id;
  perform public.vihem_kp_audit(o.organisation_id, null, 'system', 'receipt_issued', 'order', o.id::text, jsonb_build_object('receipt_id', v_id, 'kind', v_kind, 'amount', v_total));
  return v_id;
end;
$$;
revoke all on function public.vihem_kp_issue_receipt(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.vihem_kp_issue_receipt(uuid, uuid, uuid) to service_role;

-- Uppdaterade/nya e-postmallar: kvittot skickas som PDF-bilaga
update public.vihem_kp_email_templates set name = 'Kvitto (kortbetalning)', subject = 'Kvitto {{receipt_number}} – order {{order_number}}',
  body = E'Hej {{name}},\n\nTack för din betalning på {{total}} kr för order {{order_number}}. Ditt kvitto {{receipt_number}} finns som bilaga och under Mina sidor.\n\nDin utbildning är nu tillgänglig: {{portal_url}}\n\nVänliga hälsningar\nKompetensportalen / WPE Sweden AB'
  where key = 'payment_received';
insert into public.vihem_kp_email_templates (organisation_id, key, name, subject, body)
  select organisation_id, 'refund_receipt', 'Kreditkvitto (återbetalning)', 'Kreditkvitto {{receipt_number}} – order {{order_number}}', E'Hej {{name}},\n\nVi har återbetalat {{total}} kr för order {{order_number}}. Kreditkvittot {{receipt_number}} finns som bilaga och under Mina sidor. Pengarna syns normalt på ditt kort inom 5–10 bankdagar.\n\nVänliga hälsningar\nKompetensportalen / WPE Sweden AB'
  from public.vihem_kp_settings on conflict (organisation_id, key) do nothing;

commit;
