-- Kompetensportalen 2.0 – del B: kunder, deltagare, kurstillfällen, order, betalning, platser (licenser) och enrollments.
-- Betalning, order, bokning och behörighet är separata tabeller. Tillgång ges bara av vihem_kp_enable_order_access (service_role),
-- som anropas av verifierad Stripe-webhook eller av administratör/faktureringsflödet.
begin;

create table if not exists public.vihem_kp_audit_log (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  actor_user_id uuid,
  actor_kind text not null default 'system',
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists vihem_kp_audit_entity on public.vihem_kp_audit_log (entity_type, entity_id, created_at desc);
create or replace function public.vihem_kp_audit(p_org uuid, p_actor uuid, p_kind text, p_action text, p_type text, p_id text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.vihem_kp_audit_log (organisation_id, actor_user_id, actor_kind, action, entity_type, entity_id, detail) values (p_org, p_actor, p_kind, p_action, p_type, p_id, coalesce(p_detail, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Företagskunder, deltagare, medlemskap
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_kp_customers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  name text not null,
  org_number text not null,
  vat_number text not null default '',
  billing_address text not null default '',
  billing_postal_code text not null default '',
  billing_city text not null default '',
  billing_country text not null default 'SE',
  invoice_email text not null default '',
  reference text not null default '',
  contact_name text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  status text not null default 'active' check (status in ('active', 'blocked')),
  invoice_purchase_allowed boolean not null default false,
  invoice_access_mode text not null default 'inherit' check (invoice_access_mode in ('inherit', 'immediate', 'after_payment')),
  payment_terms_days integer check (payment_terms_days is null or payment_terms_days between 1 and 120),
  credit_limit numeric(12,2),
  credit_checked_at timestamptz,
  notes text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, org_number)
);
create trigger vihem_kp_customers_touch before update on public.vihem_kp_customers for each row execute function public.vihem_kp_touch();
alter table public.vihem_kp_price_rules add constraint vihem_kp_price_rules_customer_fk foreign key (customer_id) references public.vihem_kp_customers(id) on delete cascade;

create table if not exists public.vihem_kp_participants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  status text not null default 'active' check (status in ('active', 'anonymized')),
  identity_verified_at timestamptz,
  identity_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vihem_kp_participants_email on public.vihem_kp_participants (organisation_id, lower(email));
create trigger vihem_kp_participants_touch before update on public.vihem_kp_participants for each row execute function public.vihem_kp_touch();

-- Personnummer: krypterat, utan någon RLS-policy (bara service_role når tabellen).
create table if not exists public.vihem_kp_participant_identity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organisation_id uuid not null,
  personal_number_enc text not null,
  last4 text not null,
  verified_at timestamptz,
  verified_method text,
  legal_basis text not null default '',
  created_at timestamptz not null default now()
);
alter table public.vihem_kp_participant_identity enable row level security;
revoke all on public.vihem_kp_participant_identity from anon, authenticated;

create table if not exists public.vihem_kp_company_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  customer_id uuid not null references public.vihem_kp_customers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  status text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  invited_by uuid,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  left_at timestamptz
);
create unique index if not exists vihem_kp_member_active on public.vihem_kp_company_members (customer_id, lower(email)) where status <> 'removed';
create index if not exists vihem_kp_member_user on public.vihem_kp_company_members (user_id) where status = 'active';

-- ---------------------------------------------------------------------------------------------------------
-- Kurstillfällen (lärarledda utbildningar)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_kp_sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  course_id uuid not null references public.vihem_kp_courses(id) on delete restrict,
  product_id uuid references public.vihem_kp_products(id),
  title text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Europe/Stockholm',
  location_kind text not null default 'physical' check (location_kind in ('physical', 'online')),
  location text not null default '',
  meeting_url text not null default '',
  instructor_name text not null default '',
  capacity integer not null check (capacity >= 1),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'cancelled', 'completed')),
  free_cancellation_hours integer not null default 48 check (free_cancellation_hours >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create trigger vihem_kp_sessions_touch before update on public.vihem_kp_sessions for each row execute function public.vihem_kp_touch();
create index if not exists vihem_kp_sessions_when on public.vihem_kp_sessions (organisation_id, starts_at);
alter table public.vihem_kp_products add column if not exists session_id uuid references public.vihem_kp_sessions(id);

-- ---------------------------------------------------------------------------------------------------------
-- Order, orderrader, betalningar, återbetalningar
-- ---------------------------------------------------------------------------------------------------------
create sequence if not exists public.vihem_kp_order_seq;
create table if not exists public.vihem_kp_orders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  order_number text not null unique,
  buyer_user_id uuid references auth.users(id) on delete set null,
  customer_id uuid references public.vihem_kp_customers(id),
  buyer_type text not null check (buyer_type in ('private', 'company')),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'awaiting_invoice_approval', 'invoiced', 'paid', 'fulfilled', 'cancelled', 'expired', 'failed', 'refunded', 'partially_refunded')),
  payment_method text not null check (payment_method in ('stripe', 'invoice', 'free')),
  currency text not null default 'SEK',
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  vat_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  amount_refunded numeric(12,2) not null default 0,
  discount_code_id uuid references public.vihem_kp_discount_codes(id),
  contact_email text not null default '',
  billing jsonb not null default '{}'::jsonb,
  terms_acceptance jsonb not null default '{}'::jsonb,
  idempotency_key text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  invoice_link_id uuid,
  invoice_status text,
  access_enabled boolean not null default false,
  access_enabled_at timestamptz,
  expires_at timestamptz,
  internal_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vihem_kp_orders_idem on public.vihem_kp_orders (organisation_id, idempotency_key) where idempotency_key is not null;
create index if not exists vihem_kp_orders_buyer on public.vihem_kp_orders (buyer_user_id);
create index if not exists vihem_kp_orders_customer on public.vihem_kp_orders (customer_id);
create index if not exists vihem_kp_orders_session on public.vihem_kp_orders (stripe_checkout_session_id);
create trigger vihem_kp_orders_touch before update on public.vihem_kp_orders for each row execute function public.vihem_kp_touch();

create table if not exists public.vihem_kp_order_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  order_id uuid not null references public.vihem_kp_orders(id) on delete cascade,
  product_id uuid not null references public.vihem_kp_products(id),
  course_id uuid references public.vihem_kp_courses(id),
  session_id uuid references public.vihem_kp_sessions(id),
  description text not null,
  quantity integer not null check (quantity > 0),
  list_price numeric(12,2) not null,
  unit_price numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  net_total numeric(12,2) not null,
  vat_rate numeric(5,2) not null,
  vat_amount numeric(12,2) not null,
  line_total numeric(12,2) not null,
  price_label text not null default '',
  snapshot jsonb not null default '{}'::jsonb
);
create index if not exists vihem_kp_order_items_order on public.vihem_kp_order_items (order_id);

create table if not exists public.vihem_kp_payments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  order_id uuid not null references public.vihem_kp_orders(id),
  provider text not null check (provider in ('stripe', 'invoice', 'manual')),
  provider_ref text,
  status text not null check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  amount numeric(12,2) not null,
  currency text not null default 'SEK',
  paid_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists vihem_kp_payments_ref on public.vihem_kp_payments (provider, provider_ref) where provider_ref is not null;

create table if not exists public.vihem_kp_refunds (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  order_id uuid not null references public.vihem_kp_orders(id),
  provider text not null default 'stripe',
  provider_ref text,
  amount numeric(12,2) not null check (amount > 0),
  reason text not null default '',
  kind text not null default 'refund' check (kind in ('refund', 'credit_note', 'dispute')),
  access_revoked boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists vihem_kp_refunds_ref on public.vihem_kp_refunds (provider, provider_ref) where provider_ref is not null;

create table if not exists public.vihem_kp_stripe_events (
  event_id text primary key,
  event_type text not null,
  order_id uuid,
  outcome text,
  processed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------
-- Platser (köpta licenser) och enrollments (tillgång för en person till en kursversion)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_kp_seats (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  order_id uuid not null references public.vihem_kp_orders(id),
  order_item_id uuid not null references public.vihem_kp_order_items(id),
  customer_id uuid references public.vihem_kp_customers(id),
  owner_user_id uuid references auth.users(id) on delete set null,
  course_id uuid not null references public.vihem_kp_courses(id),
  course_version_id uuid not null references public.vihem_kp_course_versions(id),
  session_id uuid references public.vihem_kp_sessions(id),
  status text not null default 'available' check (status in ('available', 'assigned', 'active', 'completed', 'revoked', 'expired')),
  access_enabled boolean not null default false,
  assigned_to_user_id uuid references auth.users(id) on delete set null,
  assigned_email text,
  assigned_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists vihem_kp_seats_customer on public.vihem_kp_seats (customer_id, status);
create index if not exists vihem_kp_seats_owner on public.vihem_kp_seats (owner_user_id, status);
create index if not exists vihem_kp_seats_assigned on public.vihem_kp_seats (assigned_to_user_id);
create index if not exists vihem_kp_seats_order on public.vihem_kp_seats (order_id);

create table if not exists public.vihem_kp_seat_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  seat_id uuid not null references public.vihem_kp_seats(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.vihem_kp_enrollments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.vihem_kp_courses(id),
  course_version_id uuid not null references public.vihem_kp_course_versions(id),
  seat_id uuid not null unique references public.vihem_kp_seats(id),
  sponsor_customer_id uuid references public.vihem_kp_customers(id),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed', 'expired', 'cancelled', 'revoked')),
  access_enabled boolean not null default false,
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  started_at timestamptz,
  last_activity_at timestamptz,
  last_lesson_id uuid,
  completed_at timestamptz,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vihem_kp_enrollments_user on public.vihem_kp_enrollments (user_id, status);
create index if not exists vihem_kp_enrollments_sponsor on public.vihem_kp_enrollments (sponsor_customer_id);
create trigger vihem_kp_enrollments_touch before update on public.vihem_kp_enrollments for each row execute function public.vihem_kp_touch();

create table if not exists public.vihem_kp_session_bookings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  session_id uuid not null references public.vihem_kp_sessions(id) on delete cascade,
  order_item_id uuid references public.vihem_kp_order_items(id),
  seat_id uuid references public.vihem_kp_seats(id),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  status text not null check (status in ('held', 'booked', 'waitlisted', 'cancelled', 'attended', 'no_show', 'passed', 'failed')),
  held_until timestamptz,
  booked_at timestamptz,
  cancelled_at timestamptz,
  attended_at timestamptz,
  result_note text not null default '',
  reminder_sent_at timestamptz,
  rebooked_from uuid,
  created_at timestamptz not null default now()
);
create index if not exists vihem_kp_bookings_session on public.vihem_kp_session_bookings (session_id, status);

-- ---------------------------------------------------------------------------------------------------------
-- RLS: personal läser; ändringar sker via funktioner/admin-funktionen. Kunder får även skrivas av administratör.
-- ---------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vihem_kp_customers','vihem_kp_participants','vihem_kp_company_members','vihem_kp_sessions','vihem_kp_orders','vihem_kp_order_items','vihem_kp_payments','vihem_kp_refunds',
                           'vihem_kp_seats','vihem_kp_seat_events','vihem_kp_enrollments','vihem_kp_session_bookings','vihem_kp_audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "KP staff read" on public.%I', t);
    execute format('create policy "KP staff read" on public.%I for select to authenticated using (public.vihem_kp_is_staff(organisation_id))', t);
  end loop;
  foreach t in array array['vihem_kp_customers','vihem_kp_sessions'] loop
    execute format('drop policy if exists "KP admin write" on public.%I', t);
    execute format('create policy "KP admin write" on public.%I for all to authenticated using (public.vihem_kp_is_admin(organisation_id)) with check (public.vihem_kp_is_admin(organisation_id))', t);
  end loop;
  execute 'alter table public.vihem_kp_stripe_events enable row level security';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Prisberäkning (server): lägsta pris bland giltiga regler, rabattkod, moms per rad
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_quote(p_org uuid, p_items jsonb, p_customer uuid default null, p_code text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  it jsonb; prod public.vihem_kp_products%rowtype; qty integer; rule record; v_list numeric; v_unit numeric; v_label text;
  lines jsonb := '[]'::jsonb; v_sub numeric := 0; v_disc_total numeric := 0; v_vat_total numeric := 0; v_total numeric := 0;
  code_row public.vihem_kp_discount_codes%rowtype; v_code_applied boolean := false; v_eligible numeric := 0; line jsonb; v_line_disc numeric; v_net numeric; v_vat numeric; v_lines2 jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception '[E_EMPTY] Varukorgen är tom.'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception '[E_TOO_MANY] För många rader.'; end if;
  if nullif(trim(coalesce(p_code, '')), '') is not null then
    select * into code_row from public.vihem_kp_discount_codes where organisation_id = p_org and lower(code) = lower(trim(p_code)) and active
      and (valid_from is null or valid_from <= now()) and (valid_until is null or valid_until >= now()) and (max_uses is null or used_count < max_uses);
    if code_row.id is null then raise exception '[E_CODE] Rabattkoden är ogiltig eller har gått ut.'; end if;
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin qty := (it ->> 'quantity')::integer; exception when others then qty := 0; end;
    if qty is null or qty < 1 then raise exception '[E_ITEM] Ogiltigt antal.'; end if;
    select * into prod from public.vihem_kp_products where id = nullif(it ->> 'product_id', '')::uuid and organisation_id = p_org and active
      and (sellable_from is null or sellable_from <= now()) and (sellable_until is null or sellable_until >= now());
    if prod.id is null then raise exception '[E_PRODUCT] Produkten finns inte eller kan inte köpas.'; end if;
    if qty > prod.max_quantity_per_order then raise exception '[E_ITEM] Högsta antal per order för % är %.', prod.name, prod.max_quantity_per_order; end if;
    if prod.course_id is not null and not exists (select 1 from public.vihem_kp_courses c where c.id = prod.course_id and c.status = 'published' and c.published_version_id is not null) and prod.kind = 'course' then
      raise exception '[E_PRODUCT] Kursen % är inte köpbar just nu.', prod.name;
    end if;
    v_list := prod.price; v_unit := prod.price; v_label := '';
    for rule in select * from public.vihem_kp_price_rules r where r.product_id = prod.id and r.active and r.min_quantity <= qty
        and (r.customer_id is null or r.customer_id = p_customer) and (r.valid_from is null or r.valid_from <= now()) and (r.valid_until is null or r.valid_until >= now())
        order by r.unit_price asc, r.priority desc, (r.customer_id is not null) desc limit 1 loop
      if rule.unit_price < v_unit then v_unit := rule.unit_price; v_label := rule.label; end if;
    end loop;
    lines := lines || jsonb_build_array(jsonb_build_object('product_id', prod.id, 'name', prod.name, 'sku', prod.sku, 'kind', prod.kind, 'course_id', prod.course_id,
      'session_id', coalesce(nullif(it ->> 'session_id', '')::uuid, prod.session_id), 'quantity', qty, 'list_price', v_list, 'unit_price', v_unit, 'price_label', v_label, 'vat_rate', prod.vat_rate));
    v_sub := v_sub + v_unit * qty;
    if code_row.id is not null and (cardinality(code_row.product_ids) = 0 or prod.id = any (code_row.product_ids)) then v_eligible := v_eligible + v_unit * qty; end if;
  end loop;
  -- rabattkod fördelas proportionellt på berättigade rader
  if code_row.id is not null then
    if v_sub < code_row.min_order_amount then raise exception '[E_CODE] Rabattkoden gäller från % kr.', code_row.min_order_amount; end if;
    if v_eligible <= 0 then raise exception '[E_CODE] Rabattkoden gäller inte för valda produkter.'; end if;
    v_disc_total := least(v_eligible, case when code_row.kind = 'percent' then round(v_eligible * code_row.value / 100, 2) else code_row.value end);
    v_code_applied := true;
  end if;
  for line in select * from jsonb_array_elements(lines) loop
    v_line_disc := 0;
    if v_code_applied and (cardinality(code_row.product_ids) = 0 or (line ->> 'product_id')::uuid = any (code_row.product_ids)) then
      v_line_disc := round(v_disc_total * ((line ->> 'unit_price')::numeric * (line ->> 'quantity')::integer) / v_eligible, 2);
    end if;
    v_net := (line ->> 'unit_price')::numeric * (line ->> 'quantity')::integer - v_line_disc;
    v_vat := round(v_net * (line ->> 'vat_rate')::numeric / 100, 2);
    v_vat_total := v_vat_total + v_vat; v_total := v_total + v_net + v_vat;
    v_lines2 := v_lines2 || jsonb_build_array(line || jsonb_build_object('discount', v_line_disc, 'net_total', v_net, 'vat_amount', v_vat, 'line_total', v_net + v_vat));
  end loop;
  -- avrundningsdiff mellan fördelad och total rabatt läggs på sista berättigade raden (summan måste stämma exakt)
  return jsonb_build_object('lines', v_lines2, 'subtotal', v_sub, 'discount_total', (select coalesce(sum((l ->> 'discount')::numeric), 0) from jsonb_array_elements(v_lines2) l),
    'vat_total', v_vat_total, 'total', v_total, 'currency', 'SEK', 'discount_code_id', code_row.id, 'code_applied', v_code_applied);
end;
$$;
revoke all on function public.vihem_kp_quote(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.vihem_kp_quote(uuid, jsonb, uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Kurstillfällen: kapacitet kontrolleras under radlås så att överbokning är omöjlig
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_session_taken(p_session uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.vihem_kp_session_bookings
   where session_id = p_session and (status in ('booked', 'attended', 'passed', 'failed', 'no_show') or (status = 'held' and held_until > now()));
$$;

create or replace function public.vihem_kp_session_hold(p_session uuid, p_qty integer, p_item uuid, p_minutes integer default 30) returns void
language plpgsql security definer set search_path = public as $$
declare s public.vihem_kp_sessions%rowtype; i integer;
begin
  select * into s from public.vihem_kp_sessions where id = p_session for update;
  if s.id is null or s.status <> 'open' or s.starts_at <= now() then raise exception '[E_SESSION] Kurstillfället går inte att boka.'; end if;
  if public.vihem_kp_session_taken(p_session) + p_qty > s.capacity then raise exception '[E_FULL] Kurstillfället har inte tillräckligt många lediga platser.'; end if;
  for i in 1..p_qty loop
    insert into public.vihem_kp_session_bookings (organisation_id, session_id, order_item_id, status, held_until) values (s.organisation_id, p_session, p_item, 'held', now() + make_interval(mins => p_minutes));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Skapa order (idempotent). Betalning/behörighet sker senare.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_create_order(
  p_org uuid, p_buyer uuid, p_customer uuid, p_buyer_type text, p_items jsonb, p_code text, p_method text, p_idem text, p_contact_email text, p_billing jsonb, p_terms jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  existing public.vihem_kp_orders%rowtype; q jsonb; st public.vihem_kp_settings%rowtype; cust public.vihem_kp_customers%rowtype;
  v_order uuid; v_number text; v_status text; line jsonb; v_item uuid; v_outstanding numeric; v_total numeric; v_hold integer := 30;
begin
  if p_idem is not null then
    select * into existing from public.vihem_kp_orders where organisation_id = p_org and idempotency_key = p_idem;
    if existing.id is not null then return jsonb_build_object('order_id', existing.id, 'order_number', existing.order_number, 'status', existing.status, 'total', existing.total, 'reused', true); end if;
  end if;
  select * into st from public.vihem_kp_settings where organisation_id = p_org;
  if st.organisation_id is null then raise exception '[E_CONFIG] Kompetensportalen är inte konfigurerad.'; end if;
  if p_buyer_type not in ('private', 'company') or p_method not in ('stripe', 'invoice', 'free') then raise exception '[E_ITEM] Ogiltig ordertyp.'; end if;
  if p_buyer_type = 'company' then
    select * into cust from public.vihem_kp_customers where id = p_customer and organisation_id = p_org;
    if cust.id is null or cust.status <> 'active' then raise exception '[E_CUSTOMER] Företagskontot kan inte användas för köp.'; end if;
  end if;
  q := public.vihem_kp_quote(p_org, p_items, case when p_buyer_type = 'company' then p_customer end, p_code);
  v_total := (q ->> 'total')::numeric;
  if v_total = 0 and p_method <> 'free' then raise exception '[E_ITEM] Gratisordrar måste använda betalsättet "free".'; end if;
  if p_method = 'free' and v_total > 0 then raise exception '[E_ITEM] Ordern är inte gratis.'; end if;
  if p_method = 'invoice' then
    if p_buyer_type <> 'company' or not st.invoice_enabled or not cust.invoice_purchase_allowed then raise exception '[E_INVOICE] Fakturaköp är inte tillgängligt för detta konto.'; end if;
    if cust.credit_limit is not null then
      select coalesce(sum(total - amount_paid), 0) into v_outstanding from public.vihem_kp_orders where customer_id = cust.id and payment_method = 'invoice' and status in ('awaiting_invoice_approval', 'invoiced', 'fulfilled', 'paid') and amount_paid < total;
      if v_outstanding + v_total > cust.credit_limit then raise exception '[E_INVOICE] Fakturaköpet överstiger kreditgränsen. Kontakta oss.'; end if;
    end if;
  end if;
  v_status := case p_method when 'stripe' then 'pending_payment' when 'free' then 'paid' else case when st.invoice_requires_approval then 'awaiting_invoice_approval' else 'invoiced' end end;
  v_number := 'KP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.vihem_kp_order_seq')::text, 6, '0');
  insert into public.vihem_kp_orders (organisation_id, order_number, buyer_user_id, customer_id, buyer_type, status, payment_method, subtotal, discount_total, vat_total, total, discount_code_id,
      contact_email, billing, terms_acceptance, idempotency_key, expires_at)
    values (p_org, v_number, p_buyer, case when p_buyer_type = 'company' then p_customer end, p_buyer_type, v_status, p_method, (q ->> 'subtotal')::numeric, (q ->> 'discount_total')::numeric, (q ->> 'vat_total')::numeric, v_total,
      nullif(q ->> 'discount_code_id', '')::uuid, coalesce(p_contact_email, ''), coalesce(p_billing, '{}'::jsonb), coalesce(p_terms, '{}'::jsonb), p_idem,
      case when p_method = 'stripe' then now() + interval '2 hours' end)
    returning id into v_order;
  for line in select * from jsonb_array_elements(q -> 'lines') loop
    insert into public.vihem_kp_order_items (organisation_id, order_id, product_id, course_id, session_id, description, quantity, list_price, unit_price, discount, net_total, vat_rate, vat_amount, line_total, price_label, snapshot)
      values (p_org, v_order, (line ->> 'product_id')::uuid, nullif(line ->> 'course_id', '')::uuid, nullif(line ->> 'session_id', '')::uuid, line ->> 'name', (line ->> 'quantity')::integer,
        (line ->> 'list_price')::numeric, (line ->> 'unit_price')::numeric, (line ->> 'discount')::numeric, (line ->> 'net_total')::numeric, (line ->> 'vat_rate')::numeric, (line ->> 'vat_amount')::numeric, (line ->> 'line_total')::numeric,
        line ->> 'price_label', jsonb_build_object('sku', line ->> 'sku', 'kind', line ->> 'kind'))
      returning id into v_item;
    if nullif(line ->> 'session_id', '') is not null then
      perform public.vihem_kp_session_hold((line ->> 'session_id')::uuid, (line ->> 'quantity')::integer, v_item, case when p_method = 'stripe' then 130 else 60 * 24 * 14 end);
    end if;
  end loop;
  perform public.vihem_kp_audit(p_org, p_buyer, 'user', 'order_created', 'order', v_order::text, jsonb_build_object('method', p_method, 'total', v_total));
  return jsonb_build_object('order_id', v_order, 'order_number', v_number, 'status', v_status, 'total', v_total, 'reused', false);
end;
$$;
revoke all on function public.vihem_kp_create_order(uuid, uuid, uuid, text, jsonb, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.vihem_kp_create_order(uuid, uuid, uuid, text, jsonb, text, text, text, text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Platser skapas vid orderbekräftelse men aktiveras (access_enabled) först när reglerna tillåter det.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_create_seats(p_order uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare o public.vihem_kp_orders%rowtype; it record; bi record; v_version uuid; v_course uuid; v_count integer := 0; i integer; v_seat uuid; v_session uuid; b record; v_validity integer;
begin
  select * into o from public.vihem_kp_orders where id = p_order for update;
  if o.id is null then raise exception '[E_NOT_FOUND] Ordern finns inte.'; end if;
  for it in select oi.*, p.kind as pkind, p.id as pid from public.vihem_kp_order_items oi join public.vihem_kp_products p on p.id = oi.product_id where oi.order_id = p_order loop
    if exists (select 1 from public.vihem_kp_seats where order_item_id = it.id) then continue; end if;
    if it.pkind = 'bundle' then
      for bi in select b2.course_product_id, b2.quantity, p2.course_id from public.vihem_kp_bundle_items b2 join public.vihem_kp_products p2 on p2.id = b2.course_product_id where b2.bundle_product_id = it.pid loop
        select published_version_id into v_version from public.vihem_kp_courses where id = bi.course_id;
        if v_version is null then raise exception '[E_PRODUCT] Kurs i paketet är inte publicerad.'; end if;
        select validity_months into v_validity from public.vihem_kp_courses where id = bi.course_id;
        for i in 1..(it.quantity * bi.quantity) loop
          insert into public.vihem_kp_seats (organisation_id, order_id, order_item_id, customer_id, owner_user_id, course_id, course_version_id) values (o.organisation_id, o.id, it.id, o.customer_id, o.buyer_user_id, bi.course_id, v_version);
          v_count := v_count + 1;
        end loop;
      end loop;
    else
      v_course := it.course_id;
      select published_version_id into v_version from public.vihem_kp_courses where id = v_course;
      if v_version is null then
        select id into v_version from public.vihem_kp_course_versions where course_id = v_course order by version desc limit 1;
      end if;
      if v_version is null then raise exception '[E_PRODUCT] Kursen saknar version.'; end if;
      for i in 1..it.quantity loop
        insert into public.vihem_kp_seats (organisation_id, order_id, order_item_id, customer_id, owner_user_id, course_id, course_version_id, session_id)
          values (o.organisation_id, o.id, it.id, o.customer_id, o.buyer_user_id, v_course, v_version, it.session_id) returning id into v_seat;
        v_count := v_count + 1;
        if it.session_id is not null then
          -- koppla en reserverad bokning till platsen
          select * into b from public.vihem_kp_session_bookings where order_item_id = it.id and seat_id is null and status in ('held', 'booked') order by created_at limit 1 for update;
          if b.id is not null then update public.vihem_kp_session_bookings set seat_id = v_seat where id = b.id; end if;
        end if;
      end loop;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Aktiverar platserna för en order (efter verifierad betalning eller godkänd faktura enligt kundens regel).
create or replace function public.vihem_kp_enable_order_access(p_order uuid, p_reason text default 'paid') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.vihem_kp_orders%rowtype; v_created integer; v_enabled integer; v_auto integer := 0; s record; v_booking record; v_user uuid;
begin
  select * into o from public.vihem_kp_orders where id = p_order for update;
  if o.id is null then raise exception '[E_NOT_FOUND] Ordern finns inte.'; end if;
  if o.status in ('cancelled', 'expired', 'failed', 'refunded') then raise exception '[E_STATE] Ordern är % och kan inte ge åtkomst.', o.status; end if;
  v_created := public.vihem_kp_create_seats(p_order);
  with upd as (update public.vihem_kp_seats set access_enabled = true where order_id = p_order and status not in ('revoked', 'expired') and not access_enabled returning id) select count(*) into v_enabled from upd;
  update public.vihem_kp_enrollments e set access_enabled = true where e.seat_id in (select id from public.vihem_kp_seats where order_id = p_order) and e.status not in ('revoked', 'cancelled');
  -- sessionsbokningar blir bekräftade
  update public.vihem_kp_session_bookings set status = 'booked', booked_at = now(), held_until = null
    where order_item_id in (select id from public.vihem_kp_order_items where order_id = p_order) and status = 'held';
  -- privatköp av exakt en plats: tilldelas köparen direkt (flera platser fördelas av köparen)
  if o.buyer_type = 'private' and o.buyer_user_id is not null and (select count(*) from public.vihem_kp_seats where order_id = p_order) = 1 then
    for s in select * from public.vihem_kp_seats where order_id = p_order and status = 'available' and assigned_to_user_id is null loop
      perform public.vihem_kp_assign_seat_internal(s.id, o.buyer_user_id, null, null);
      v_auto := v_auto + 1;
    end loop;
  end if;
  update public.vihem_kp_orders set access_enabled = true, access_enabled_at = coalesce(access_enabled_at, now()),
      status = case when status in ('paid', 'invoiced', 'awaiting_invoice_approval', 'pending_payment') and amount_paid >= total then 'fulfilled' when status = 'pending_payment' then status else status end
    where id = p_order;
  perform public.vihem_kp_audit(o.organisation_id, null, 'system', 'access_enabled', 'order', p_order::text, jsonb_build_object('reason', p_reason, 'seats_created', v_created, 'seats_enabled', v_enabled));
  return jsonb_build_object('seats_created', v_created, 'seats_enabled', v_enabled, 'auto_assigned', v_auto);
end;
$$;

-- Tilldela plats (intern, utan behörighetskontroll – anropas av validerade funktioner).
create or replace function public.vihem_kp_assign_seat_internal(p_seat uuid, p_user uuid, p_email text, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.vihem_kp_seats%rowtype; v_enr uuid; v_email text; v_cust uuid; c public.vihem_kp_courses%rowtype;
begin
  select * into s from public.vihem_kp_seats where id = p_seat for update;
  if s.id is null then raise exception '[E_NOT_FOUND] Platsen finns inte.'; end if;
  if s.status in ('revoked', 'expired', 'completed') then raise exception '[E_STATE] Platsen kan inte tilldelas.'; end if;
  if s.status in ('active') then raise exception '[E_STATE] Utbildningen är redan påbörjad och platsen kan inte flyttas.'; end if;
  select * into c from public.vihem_kp_courses where id = s.course_id;
  if p_user is null then
    update public.vihem_kp_seats set status = 'assigned', assigned_email = lower(trim(p_email)), assigned_to_user_id = null, assigned_at = now() where id = p_seat;
    insert into public.vihem_kp_seat_events (organisation_id, seat_id, event_type, actor_user_id, detail) values (s.organisation_id, p_seat, 'assigned_email', p_actor, jsonb_build_object('email', lower(trim(p_email))));
    return null;
  end if;
  select email into v_email from auth.users where id = p_user;
  -- befintlig (ostartad) enrollment på platsen ersätts
  delete from public.vihem_kp_enrollments where seat_id = p_seat and status = 'not_started';
  insert into public.vihem_kp_enrollments (organisation_id, user_id, course_id, course_version_id, seat_id, sponsor_customer_id, access_enabled)
    values (s.organisation_id, p_user, s.course_id, s.course_version_id, p_seat, s.customer_id, s.access_enabled) returning id into v_enr;
  update public.vihem_kp_seats set status = 'assigned', assigned_to_user_id = p_user, assigned_email = lower(v_email), assigned_at = now() where id = p_seat;
  insert into public.vihem_kp_seat_events (organisation_id, seat_id, event_type, actor_user_id, detail) values (s.organisation_id, p_seat, 'assigned', p_actor, jsonb_build_object('user_id', p_user));
  return v_enr;
end;
$$;
revoke all on function public.vihem_kp_create_seats(uuid), public.vihem_kp_enable_order_access(uuid, text), public.vihem_kp_assign_seat_internal(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.vihem_kp_create_seats(uuid), public.vihem_kp_enable_order_access(uuid, text), public.vihem_kp_assign_seat_internal(uuid, uuid, text, uuid) to service_role;

-- Återta en ej påbörjad plats (företagsadmin/personal) och tilldela om
create or replace function public.vihem_kp_reclaim_seat(p_seat uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.vihem_kp_seats%rowtype; e public.vihem_kp_enrollments%rowtype;
begin
  select * into s from public.vihem_kp_seats where id = p_seat for update;
  if s.id is null then raise exception '[E_NOT_FOUND] Platsen finns inte.'; end if;
  if s.status not in ('assigned', 'available') then raise exception '[E_STATE] Platsen är påbörjad, slutförd eller återkallad och kan inte återtas.'; end if;
  select * into e from public.vihem_kp_enrollments where seat_id = p_seat;
  if e.id is not null and (e.status <> 'not_started' or exists (select 1 from public.vihem_kp_lesson_progress where enrollment_id = e.id)) then raise exception '[E_STATE] Utbildningen är redan påbörjad.'; end if;
  delete from public.vihem_kp_enrollments where seat_id = p_seat;
  update public.vihem_kp_seats set status = 'available', assigned_to_user_id = null, assigned_email = null, assigned_at = null where id = p_seat;
  insert into public.vihem_kp_seat_events (organisation_id, seat_id, event_type, actor_user_id) values (s.organisation_id, p_seat, 'reclaimed', p_actor);
end;
$$;
revoke all on function public.vihem_kp_reclaim_seat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vihem_kp_reclaim_seat(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Betalning och återbetalning (idempotent)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_apply_payment(p_order uuid, p_provider text, p_ref text, p_amount numeric, p_detail jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.vihem_kp_orders%rowtype; v_rows integer; v_paid numeric; v_access jsonb; st public.vihem_kp_settings%rowtype; cust public.vihem_kp_customers%rowtype; v_mode text;
begin
  select * into o from public.vihem_kp_orders where id = p_order for update;
  if o.id is null then raise exception '[E_NOT_FOUND] Ordern finns inte.'; end if;
  insert into public.vihem_kp_payments (organisation_id, order_id, provider, provider_ref, status, amount, paid_at, detail) values (o.organisation_id, p_order, p_provider, p_ref, 'succeeded', p_amount, now(), coalesce(p_detail, '{}'::jsonb))
    on conflict (provider, provider_ref) where provider_ref is not null do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('duplicate', true, 'status', o.status); end if;
  select coalesce(sum(amount), 0) into v_paid from public.vihem_kp_payments where order_id = p_order and status = 'succeeded';
  if o.status in ('cancelled', 'expired', 'failed') then
    -- sen betalning på avbruten order: ingen åtkomst, administratör måste återbetala/avgöra
    update public.vihem_kp_orders set amount_paid = v_paid where id = p_order;
    perform public.vihem_kp_audit(o.organisation_id, null, 'system', 'late_payment_on_closed_order', 'order', p_order::text, jsonb_build_object('amount', p_amount));
    return jsonb_build_object('late_payment', true, 'status', o.status);
  end if;
  update public.vihem_kp_orders set amount_paid = v_paid, status = case when v_paid >= total and status not in ('refunded', 'partially_refunded') then 'paid' else status end where id = p_order returning * into o;
  if o.status = 'paid' then
    if o.discount_code_id is not null then update public.vihem_kp_discount_codes set used_count = used_count + 1 where id = o.discount_code_id; end if;
    v_access := public.vihem_kp_enable_order_access(p_order, 'payment');
  end if;
  return jsonb_build_object('status', (select status from public.vihem_kp_orders where id = p_order), 'access', v_access);
end;
$$;

-- Godkänn fakturaköp: access enligt kundens/organisationens regel (omedelbart eller först efter betalning)
create or replace function public.vihem_kp_approve_invoice_order(p_order uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.vihem_kp_orders%rowtype; st public.vihem_kp_settings%rowtype; cust public.vihem_kp_customers%rowtype; v_mode text; v_seats integer;
begin
  select * into o from public.vihem_kp_orders where id = p_order for update;
  if o.id is null or o.payment_method <> 'invoice' then raise exception '[E_NOT_FOUND] Fakturaordern finns inte.'; end if;
  if o.status not in ('awaiting_invoice_approval', 'invoiced') then raise exception '[E_STATE] Ordern är % och kan inte godkännas.', o.status; end if;
  select * into st from public.vihem_kp_settings where organisation_id = o.organisation_id;
  select * into cust from public.vihem_kp_customers where id = o.customer_id;
  v_mode := case when cust.invoice_access_mode = 'inherit' then st.invoice_access_mode else cust.invoice_access_mode end;
  update public.vihem_kp_orders set status = 'invoiced' where id = p_order;
  v_seats := public.vihem_kp_create_seats(p_order);
  if v_mode = 'immediate' then perform public.vihem_kp_enable_order_access(p_order, 'invoice_immediate'); end if;
  perform public.vihem_kp_audit(o.organisation_id, p_actor, 'staff', 'invoice_order_approved', 'order', p_order::text, jsonb_build_object('access_mode', v_mode));
  return jsonb_build_object('access_mode', v_mode, 'seats', v_seats);
end;
$$;

create or replace function public.vihem_kp_revoke_order_access(p_order uuid, p_reason text, p_actor uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare o public.vihem_kp_orders%rowtype; v_n integer;
begin
  select * into o from public.vihem_kp_orders where id = p_order for update;
  if o.id is null then raise exception '[E_NOT_FOUND] Ordern finns inte.'; end if;
  with u as (update public.vihem_kp_seats set status = 'revoked', access_enabled = false, revoked_at = now(), revoke_reason = left(coalesce(p_reason, ''), 500)
              where order_id = p_order and status not in ('completed', 'revoked') returning id) select count(*) into v_n from u;
  update public.vihem_kp_enrollments set access_enabled = false, status = case when status = 'completed' then status else 'revoked' end
    where seat_id in (select id from public.vihem_kp_seats where order_id = p_order and status = 'revoked');
  update public.vihem_kp_session_bookings set status = 'cancelled', cancelled_at = now() where order_item_id in (select id from public.vihem_kp_order_items where order_id = p_order) and status in ('held', 'booked', 'waitlisted');
  update public.vihem_kp_orders set access_enabled = false where id = p_order;
  perform public.vihem_kp_audit(o.organisation_id, p_actor, case when p_actor is null then 'system' else 'staff' end, 'access_revoked', 'order', p_order::text, jsonb_build_object('reason', p_reason, 'seats', v_n));
  return v_n;
end;
$$;

create or replace function public.vihem_kp_record_refund(p_order uuid, p_amount numeric, p_ref text, p_reason text, p_kind text, p_actor uuid, p_revoke boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.vihem_kp_orders%rowtype; v_rows integer; v_total_ref numeric; v_revoked integer := 0; st public.vihem_kp_settings%rowtype; v_full boolean;
begin
  select * into o from public.vihem_kp_orders where id = p_order for update;
  if o.id is null then raise exception '[E_NOT_FOUND] Ordern finns inte.'; end if;
  insert into public.vihem_kp_refunds (organisation_id, order_id, provider, provider_ref, amount, reason, kind, created_by) values (o.organisation_id, p_order, case when o.payment_method = 'invoice' then 'invoice' else 'stripe' end, p_ref, p_amount, coalesce(p_reason, ''), coalesce(p_kind, 'refund'), p_actor)
    on conflict (provider, provider_ref) where provider_ref is not null do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('duplicate', true); end if;
  select coalesce(sum(amount), 0) into v_total_ref from public.vihem_kp_refunds where order_id = p_order;
  v_full := v_total_ref >= o.amount_paid and o.amount_paid > 0;
  update public.vihem_kp_orders set amount_refunded = v_total_ref, status = case when v_full then 'refunded' else 'partially_refunded' end where id = p_order;
  select * into st from public.vihem_kp_settings where organisation_id = o.organisation_id;
  if p_revoke or (v_full and st.refund_revokes_access) or (p_kind = 'dispute' and st.dispute_revokes_access) then
    v_revoked := public.vihem_kp_revoke_order_access(p_order, coalesce(p_reason, 'Återbetalning'), p_actor);
    update public.vihem_kp_refunds set access_revoked = true where order_id = p_order and provider_ref is not distinct from p_ref;
  end if;
  perform public.vihem_kp_audit(o.organisation_id, p_actor, case when p_actor is null then 'system' else 'staff' end, 'refund_recorded', 'order', p_order::text, jsonb_build_object('amount', p_amount, 'kind', p_kind, 'revoked', v_revoked));
  return jsonb_build_object('full', v_full, 'revoked', v_revoked);
end;
$$;
revoke all on function public.vihem_kp_apply_payment(uuid, text, text, numeric, jsonb), public.vihem_kp_approve_invoice_order(uuid, uuid), public.vihem_kp_revoke_order_access(uuid, text, uuid), public.vihem_kp_record_refund(uuid, numeric, text, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.vihem_kp_apply_payment(uuid, text, text, numeric, jsonb), public.vihem_kp_approve_invoice_order(uuid, uuid), public.vihem_kp_revoke_order_access(uuid, text, uuid), public.vihem_kp_record_refund(uuid, numeric, text, text, text, uuid, boolean) to service_role;

-- Utgångna ordrar/reservationer städas varje minut
create or replace function public.vihem_kp_expire_orders() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with e as (update public.vihem_kp_orders set status = 'expired' where status = 'pending_payment' and expires_at < now() returning id) select count(*) into v_n from e;
  update public.vihem_kp_session_bookings set status = 'cancelled', cancelled_at = now() where status = 'held' and held_until < now();
  return v_n;
end;
$$;
revoke all on function public.vihem_kp_expire_orders() from public, anon, authenticated;
grant execute on function public.vihem_kp_expire_orders() to service_role;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'vihem-kp-expire-orders') then perform cron.unschedule('vihem-kp-expire-orders'); end if;
  perform cron.schedule('vihem-kp-expire-orders', '* * * * *', $job$ SELECT public.vihem_kp_expire_orders(); $job$);
end $$;

-- Accounted: tillåt källtypen course_order (bakåtkompatibel utvidgning av CHECK)
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.vihem_accounted_invoice_links'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source_type%' loop
    execute format('alter table public.vihem_accounted_invoice_links drop constraint %I', c.conname);
  end loop;
  alter table public.vihem_accounted_invoice_links add constraint vihem_accounted_invoice_links_source_type_check
    check (source_type = any (array['rental_billing', 'customer_project', 'manual_charge', 'course_order']));
end $$;

commit;
