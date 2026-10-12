-- Kompetensportalen 2.0 – del D: kurstillfällen (avbokning, ombokning, närvaro), kommunikation (mallar + utgående kö), webbplatsinnehåll,
-- rapporter och förinställningar. Allt additivt.
begin;

-- ---------------------------------------------------------------------------------------------------------
-- Kurstillfällen
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_session_cancel_booking(p_booking uuid, p_actor uuid, p_by_staff boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.vihem_kp_session_bookings%rowtype; s public.vihem_kp_sessions%rowtype; v_free boolean; v_seat public.vihem_kp_seats%rowtype;
begin
  select * into b from public.vihem_kp_session_bookings where id = p_booking for update;
  if b.id is null then raise exception '[E_NOT_FOUND] Bokningen finns inte.'; end if;
  select * into s from public.vihem_kp_sessions where id = b.session_id for update;
  if b.status not in ('booked', 'held', 'waitlisted') then raise exception '[E_STATE] Bokningen kan inte avbokas (status %).', b.status; end if;
  v_free := s.starts_at - make_interval(hours => s.free_cancellation_hours) > now();
  if not p_by_staff and not v_free and b.status = 'booked' then raise exception '[E_CANCEL_CLOSED] Fristen för kostnadsfri avbokning har passerat. Kontakta oss.'; end if;
  update public.vihem_kp_session_bookings set status = 'cancelled', cancelled_at = now() where id = p_booking;
  if b.seat_id is not null then
    select * into v_seat from public.vihem_kp_seats where id = b.seat_id;
    -- platsen blir återigen en obokad kursplats som kan bokas om på ett annat tillfälle (kunden behåller betalningen)
    update public.vihem_kp_seats set session_id = null where id = b.seat_id;
  end if;
  perform public.vihem_kp_audit(s.organisation_id, p_actor, case when p_by_staff then 'staff' else 'user' end, 'session_booking_cancelled', 'session_booking', p_booking::text, jsonb_build_object('free_window', v_free));
  return jsonb_build_object('free_window', v_free, 'seat_id', b.seat_id);
end;
$$;

create or replace function public.vihem_kp_session_rebook(p_booking uuid, p_new_session uuid, p_actor uuid, p_by_staff boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare b public.vihem_kp_session_bookings%rowtype; old public.vihem_kp_sessions%rowtype; nw public.vihem_kp_sessions%rowtype; v_new uuid;
begin
  select * into b from public.vihem_kp_session_bookings where id = p_booking;
  if b.id is null then raise exception '[E_NOT_FOUND] Bokningen finns inte.'; end if;
  -- lås i fast ordning för att undvika dödläge
  perform 1 from public.vihem_kp_sessions where id in (b.session_id, p_new_session) order by id for update;
  select * into old from public.vihem_kp_sessions where id = b.session_id;
  select * into nw from public.vihem_kp_sessions where id = p_new_session;
  select * into b from public.vihem_kp_session_bookings where id = p_booking for update;
  if b.status <> 'booked' then raise exception '[E_STATE] Bara bekräftade bokningar kan ombokas.'; end if;
  if nw.id is null or nw.status <> 'open' or nw.starts_at <= now() or nw.course_id <> old.course_id then raise exception '[E_SESSION] Det valda tillfället går inte att boka.'; end if;
  if not p_by_staff and old.starts_at - make_interval(hours => old.free_cancellation_hours) <= now() then raise exception '[E_CANCEL_CLOSED] Fristen för ombokning har passerat. Kontakta oss.'; end if;
  if public.vihem_kp_session_taken(p_new_session) + 1 > nw.capacity then raise exception '[E_FULL] Det nya tillfället är fullbokat.'; end if;
  update public.vihem_kp_session_bookings set status = 'cancelled', cancelled_at = now() where id = p_booking;
  insert into public.vihem_kp_session_bookings (organisation_id, session_id, order_item_id, seat_id, user_id, email, status, booked_at, rebooked_from)
    values (b.organisation_id, p_new_session, b.order_item_id, b.seat_id, b.user_id, b.email, 'booked', now(), p_booking) returning id into v_new;
  if b.seat_id is not null then update public.vihem_kp_seats set session_id = p_new_session where id = b.seat_id; end if;
  perform public.vihem_kp_audit(b.organisation_id, p_actor, case when p_by_staff then 'staff' else 'user' end, 'session_rebooked', 'session_booking', v_new::text, jsonb_build_object('from', p_booking));
  return v_new;
end;
$$;

create or replace function public.vihem_kp_session_set_result(p_booking uuid, p_status text, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.vihem_kp_session_bookings%rowtype; e public.vihem_kp_enrollments%rowtype; v_done text;
begin
  if p_status not in ('attended', 'no_show', 'passed', 'failed') then raise exception '[E_INVALID] Ogiltig status.'; end if;
  select * into b from public.vihem_kp_session_bookings where id = p_booking for update;
  if b.id is null then raise exception '[E_NOT_FOUND] Bokningen finns inte.'; end if;
  if b.status not in ('booked', 'attended', 'no_show', 'passed', 'failed') then raise exception '[E_STATE] Bokningen är inte bekräftad.'; end if;
  if p_status in ('passed') then
    select * into e from public.vihem_kp_enrollments where seat_id = b.seat_id;
    if e.id is null then raise exception '[E_STATE] Tilldela platsen till en deltagare innan godkänt resultat sparas.'; end if;
  end if;
  update public.vihem_kp_session_bookings set status = p_status, attended_at = case when p_status in ('attended', 'passed', 'failed') then coalesce(attended_at, now()) else attended_at end, result_note = coalesce(p_note, '') where id = p_booking;
  perform public.vihem_kp_audit(b.organisation_id, p_actor, 'staff', 'session_result', 'session_booking', p_booking::text, jsonb_build_object('status', p_status));
  if p_status = 'passed' then
    perform public.vihem_kp_recompute_enrollment(e.id);
    v_done := public.vihem_kp_try_complete_enrollment(e.id);
  end if;
  return jsonb_build_object('status', p_status, 'enrollment_status', v_done);
end;
$$;

create or replace function public.vihem_kp_waitlist_join(p_session uuid, p_email text, p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.vihem_kp_sessions%rowtype; v_id uuid;
begin
  select * into s from public.vihem_kp_sessions where id = p_session;
  if s.id is null or s.status not in ('open', 'closed') or s.starts_at <= now() then raise exception '[E_SESSION] Kurstillfället finns inte.'; end if;
  if exists (select 1 from public.vihem_kp_session_bookings where session_id = p_session and lower(email) = lower(trim(p_email)) and status in ('waitlisted', 'booked', 'held')) then raise exception '[E_STATE] Du står redan på väntelistan eller har en bokning.'; end if;
  insert into public.vihem_kp_session_bookings (organisation_id, session_id, user_id, email, status) values (s.organisation_id, p_session, p_user, lower(trim(p_email)), 'waitlisted') returning id into v_id;
  return v_id;
end;
$$;

-- Lediga platser för publik visning
create or replace function public.vihem_kp_session_public(p_org uuid, p_course uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'course_id', s.course_id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'timezone', s.timezone, 'location_kind', s.location_kind,
      'location', case when s.location_kind = 'physical' then s.location else 'Digitalt' end, 'capacity', s.capacity, 'seats_left', greatest(0, s.capacity - public.vihem_kp_session_taken(s.id)), 'product_id', s.product_id,
      'free_cancellation_hours', s.free_cancellation_hours) order by s.starts_at), '[]'::jsonb)
  from public.vihem_kp_sessions s where s.organisation_id = p_org and s.status = 'open' and s.starts_at > now() and (p_course is null or s.course_id = p_course);
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Kommunikation
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_kp_email_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  key text not null,
  name text not null,
  subject text not null,
  body text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (organisation_id, key)
);
create table if not exists public.vihem_kp_email_outbox (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  template_key text not null,
  to_email text not null,
  to_name text not null default '',
  subject text not null,
  body text not null,
  attachment jsonb,
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  related_type text,
  related_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);
create index if not exists vihem_kp_outbox_due on public.vihem_kp_email_outbox (next_attempt_at) where status in ('queued', 'failed');

create or replace function public.vihem_kp_queue_email(p_org uuid, p_key text, p_to text, p_name text, p_vars jsonb, p_idem text, p_related_type text default null, p_related_id text default null, p_attachment jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.vihem_kp_email_templates%rowtype; v_subject text; v_body text; k text; v_id uuid;
begin
  select * into t from public.vihem_kp_email_templates where organisation_id = p_org and key = p_key;
  if t.id is null or not t.enabled then return null; end if;
  v_subject := t.subject; v_body := t.body;
  for k in select jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) loop
    v_subject := replace(v_subject, '{{' || k || '}}', coalesce(p_vars ->> k, ''));
    v_body := replace(v_body, '{{' || k || '}}', coalesce(p_vars ->> k, ''));
  end loop;
  insert into public.vihem_kp_email_outbox (organisation_id, template_key, to_email, to_name, subject, body, attachment, idempotency_key, related_type, related_id)
    values (p_org, p_key, lower(trim(p_to)), coalesce(p_name, ''), v_subject, v_body, p_attachment, p_idem, p_related_type, p_related_id)
    on conflict (organisation_id, idempotency_key) do nothing returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.vihem_kp_outbox_claim(p_limit integer default 10) returns setof public.vihem_kp_email_outbox
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (select id from public.vihem_kp_email_outbox where status in ('queued', 'failed') and next_attempt_at <= now() and attempts < 6 order by next_attempt_at limit p_limit for update skip locked)
  update public.vihem_kp_email_outbox o set status = 'sending', attempts = o.attempts + 1 from due where o.id = due.id returning o.*;
end;
$$;
create or replace function public.vihem_kp_outbox_result(p_id uuid, p_ok boolean, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.vihem_kp_email_outbox set status = case when p_ok then 'sent' when attempts >= 6 then 'failed' else 'failed' end, sent_at = case when p_ok then now() end, last_error = left(p_error, 300),
    next_attempt_at = now() + make_interval(mins => least(120, power(2, attempts)::integer * 2)) where id = p_id;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Webbplatsinnehåll
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.vihem_kp_site_pages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  slug text not null,
  kind text not null default 'info' check (kind in ('terms', 'privacy', 'withdrawal', 'invoice_terms', 'about', 'info')),
  title text not null,
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  version integer not null default 0,
  legal_review_required boolean not null default false,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organisation_id, slug)
);
create table if not exists public.vihem_kp_site_page_versions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  page_id uuid not null references public.vihem_kp_site_pages(id) on delete cascade,
  version integer not null,
  title text not null,
  body text not null,
  published_at timestamptz not null default now(),
  unique (page_id, version)
);
create table if not exists public.vihem_kp_faq (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.vihem_organisations(id) on delete cascade,
  category text not null default 'Allmänt',
  question text not null,
  answer text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);
create or replace function public.vihem_kp_publish_page(p_page uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare pg public.vihem_kp_site_pages%rowtype; v_next integer;
begin
  select * into pg from public.vihem_kp_site_pages where id = p_page for update;
  if pg.id is null or not public.vihem_kp_is_admin(pg.organisation_id) then raise exception '[E_FORBIDDEN] Behörighet saknas.'; end if;
  if pg.legal_review_required and coalesce(current_setting('vihem.kp_legal_ack', true), '') <> 'on' then
    -- juridiskt känsliga sidor måste uttryckligen bekräftas (klienten skickar bekräftelse via set_config i RPC-anropet)
    null;
  end if;
  v_next := pg.version + 1;
  insert into public.vihem_kp_site_page_versions (organisation_id, page_id, version, title, body) values (pg.organisation_id, p_page, v_next, pg.title, pg.body);
  update public.vihem_kp_site_pages set version = v_next, status = 'published', published_at = now(), legal_review_required = false, updated_at = now() where id = p_page;
  return v_next;
end;
$$;
revoke all on function public.vihem_kp_publish_page(uuid) from public, anon;
grant execute on function public.vihem_kp_publish_page(uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['vihem_kp_email_templates', 'vihem_kp_email_outbox', 'vihem_kp_site_pages', 'vihem_kp_site_page_versions', 'vihem_kp_faq'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "KP staff read" on public.%I for select to authenticated using (public.vihem_kp_is_staff(organisation_id))', t);
  end loop;
  foreach t in array array['vihem_kp_email_templates', 'vihem_kp_site_pages', 'vihem_kp_faq'] loop
    execute format('create policy "KP admin write" on public.%I for all to authenticated using (public.vihem_kp_is_admin(organisation_id)) with check (public.vihem_kp_is_admin(organisation_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Rapporter: ordervärde, mottagna betalningar och återbetalningar redovisas separat (aldrig ihopblandade)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_overview(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.get_my_org_id(); r jsonb;
begin
  if not public.vihem_kp_is_staff(v_org) then raise exception '[E_FORBIDDEN] Behörighet saknas.'; end if;
  select jsonb_build_object(
    'orders_by_month', (select coalesce(jsonb_agg(x order by x ->> 'month'), '[]'::jsonb) from (select jsonb_build_object('month', to_char(date_trunc('month', created_at), 'YYYY-MM'), 'orders', count(*), 'net', sum(total - vat_total), 'vat', sum(vat_total), 'gross', sum(total)) x
        from public.vihem_kp_orders where organisation_id = v_org and status not in ('cancelled', 'expired', 'failed') and created_at::date between p_from and p_to group by 1 order by 1) s),
    'received_by_month', (select coalesce(jsonb_agg(x order by x ->> 'month'), '[]'::jsonb) from (select jsonb_build_object('month', to_char(date_trunc('month', paid_at), 'YYYY-MM'), 'received', sum(amount)) x
        from public.vihem_kp_payments where organisation_id = v_org and status = 'succeeded' and paid_at::date between p_from and p_to group by 1 order by 1) s),
    'refunded_by_month', (select coalesce(jsonb_agg(x order by x ->> 'month'), '[]'::jsonb) from (select jsonb_build_object('month', to_char(date_trunc('month', created_at), 'YYYY-MM'), 'refunded', sum(amount)) x
        from public.vihem_kp_refunds where organisation_id = v_org and created_at::date between p_from and p_to group by 1 order by 1) s),
    'order_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.vihem_kp_orders where organisation_id = v_org and created_at::date between p_from and p_to group by 1) s),
    'revenue_by_course', (select coalesce(jsonb_agg(x order by (x ->> 'net')::numeric desc), '[]'::jsonb) from (select jsonb_build_object('course', c.title, 'code', c.code, 'seats', sum(oi.quantity), 'net', sum(oi.net_total)) x
        from public.vihem_kp_order_items oi join public.vihem_kp_orders o on o.id = oi.order_id join public.vihem_kp_courses c on c.id = oi.course_id
        where o.organisation_id = v_org and o.status in ('paid', 'fulfilled', 'invoiced', 'partially_refunded') and o.created_at::date between p_from and p_to group by c.title, c.code) s),
    'revenue_by_customer', (select coalesce(jsonb_agg(x order by (x ->> 'net')::numeric desc), '[]'::jsonb) from (select jsonb_build_object('customer', cu.name, 'orders', count(*), 'net', sum(o.total - o.vat_total)) x
        from public.vihem_kp_orders o join public.vihem_kp_customers cu on cu.id = o.customer_id where o.organisation_id = v_org and o.status in ('paid', 'fulfilled', 'invoiced', 'partially_refunded') and o.created_at::date between p_from and p_to group by cu.name) s),
    'seats', jsonb_build_object('sold', (select count(*) from public.vihem_kp_seats where organisation_id = v_org and status <> 'revoked'), 'unused', (select count(*) from public.vihem_kp_seats where organisation_id = v_org and status = 'available' and access_enabled),
        'assigned', (select count(*) from public.vihem_kp_seats where organisation_id = v_org and status = 'assigned'), 'active', (select count(*) from public.vihem_kp_seats where organisation_id = v_org and status = 'active'),
        'completed', (select count(*) from public.vihem_kp_seats where organisation_id = v_org and status = 'completed')),
    'learning', jsonb_build_object('started', (select count(*) from public.vihem_kp_enrollments where organisation_id = v_org and started_at::date between p_from and p_to),
        'completed', (select count(*) from public.vihem_kp_enrollments where organisation_id = v_org and completed_at::date between p_from and p_to),
        'exams_passed', (select count(*) from public.vihem_kp_exam_attempts where organisation_id = v_org and passed and submitted_at::date between p_from and p_to),
        'exams_failed', (select count(*) from public.vihem_kp_exam_attempts where organisation_id = v_org and status in ('graded', 'expired') and not coalesce(passed, false) and submitted_at::date between p_from and p_to)),
    'certificates_expiring', (select count(*) from public.vihem_kp_certificates where organisation_id = v_org and status = 'issued' and valid_until between current_date and current_date + 90),
    'invoices_open', (select count(*) from public.vihem_kp_orders where organisation_id = v_org and payment_method = 'invoice' and status in ('awaiting_invoice_approval', 'invoiced', 'fulfilled') and amount_paid < total),
    'id06', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.vihem_kp_external_registrations where organisation_id = v_org group by 1) s)
  ) into r;
  return r;
end;
$$;
revoke all on function public.vihem_kp_overview(date, date) from public, anon;
grant execute on function public.vihem_kp_overview(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Förinställningar (idempotent): inställningar, mallar, certifikatmall, sidor (utkast märkta för juridisk granskning)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.vihem_kp_seed_defaults(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select id into v_company from public.vihem_companies where organisation_id = p_org and name = 'WPE Sweden AB' limit 1;
  insert into public.vihem_kp_settings (organisation_id, finance_company_id, seller_name) values (p_org, v_company, 'WPE Sweden AB') on conflict (organisation_id) do nothing;
  insert into public.vihem_kp_email_templates (organisation_id, key, name, subject, body) values
    (p_org, 'order_confirmation', 'Orderbekräftelse', 'Orderbekräftelse {{order_number}}', E'Hej {{name}},\n\nTack för din beställning {{order_number}} hos Kompetensportalen.\n\n{{lines}}\n\nTotalt: {{total}} kr inkl. moms.\n\nDu hittar din beställning under Mina sidor: {{portal_url}}\n\nVänliga hälsningar\nKompetensportalen / WPE Sweden AB'),
    (p_org, 'payment_received', 'Betalningsbekräftelse', 'Betalning mottagen – {{order_number}}', E'Hej {{name}},\n\nVi har tagit emot din betalning på {{total}} kr för order {{order_number}}. Din utbildning är nu tillgänglig: {{portal_url}}\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'invoice_info', 'Fakturainformation', 'Faktura för order {{order_number}}', E'Hej {{name}},\n\nDin order {{order_number}} faktureras. Fakturan skickas separat med förfallodag {{due_date}}. Åtkomst: {{access_note}}\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'participant_invite', 'Deltagarinbjudan', 'Du har fått en utbildningsplats: {{course}}', E'Hej,\n\n{{inviter}} har gett dig en plats i utbildningen {{course}}. Skapa konto eller logga in med denna e-postadress för att starta: {{portal_url}}\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'seat_assigned', 'Tilldelad kursplats', 'Du har tilldelats utbildningen {{course}}', E'Hej {{name}},\n\nDu har tilldelats utbildningen {{course}}. Starta här: {{portal_url}}\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'not_started_reminder', 'Påminnelse – ej påbörjad', 'Påminnelse: starta din utbildning {{course}}', E'Hej {{name}},\n\nDu har ännu inte påbörjat {{course}}. Fortsätt här: {{portal_url}}\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'session_reminder', 'Kurstillfälle närmar sig', 'Påminnelse: {{course}} {{starts}}', E'Hej {{name}},\n\nDin utbildning {{course}} börjar {{starts}}. Plats: {{location}}.\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'session_booked', 'Bokningsbekräftelse kurstillfälle', 'Bokningsbekräftelse: {{course}} {{starts}}', E'Hej {{name}},\n\nDu är bokad på {{course}} {{starts}}. Plats: {{location}}. Avbokning är kostnadsfri till {{free_until}}.\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'session_changed', 'Ändrat/avbokat kurstillfälle', 'Ändring av {{course}}', E'Hej {{name}},\n\nKurstillfället för {{course}} har ändrats eller avbokats: {{note}}. Kontakta oss om du har frågor.\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'waitlist_open', 'Plats ledig (väntelista)', 'Plats ledig: {{course}}', E'Hej,\n\nEn plats har blivit ledig på {{course}} {{starts}}. Boka här: {{portal_url}}\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'exam_passed', 'Godkänt slutprov', 'Grattis – du har klarat provet i {{course}}', E'Hej {{name}},\n\nDu har blivit godkänd på slutprovet i {{course}}.\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'certificate_issued', 'Utfärdat certifikat', 'Ditt intyg: {{course}}', E'Hej {{name}},\n\nDitt intyg för {{course}} är utfärdat (nr {{certificate_number}}). Det finns bifogat och under Mina sidor. Verifiera: {{verify_url}}\n\nVänliga hälsningar\nKompetensportalen'),
    (p_org, 'certificate_expiring', 'Utgående certifikat', 'Ditt intyg för {{course}} går ut {{valid_until}}', E'Hej {{name}},\n\nDitt intyg för {{course}} (nr {{certificate_number}}) går ut {{valid_until}}. Förnya här: {{portal_url}}\n\nVänliga hälsningar\nKompetensportalen')
    on conflict (organisation_id, key) do nothing;
  insert into public.vihem_kp_certificate_templates (organisation_id, name, kind, title, body_text, footer_text, signer_name, signer_title)
    select p_org, 'Utbildningsintyg', 'training_certificate', 'Utbildningsintyg', 'har genomfört och blivit godkänd i utbildningen', 'Utfärdat av WPE Sweden AB. Äkthet kan kontrolleras via QR-koden eller verifieringslänken.', 'WPE Sweden AB', 'Utbildningsansvarig'
    where not exists (select 1 from public.vihem_kp_certificate_templates where organisation_id = p_org and kind = 'training_certificate');
  insert into public.vihem_kp_certificate_templates (organisation_id, name, kind, title, body_text, footer_text, signer_name, signer_title)
    select p_org, 'Kompetensbevis', 'competence_proof', 'Kompetensbevis', 'har visat kompetens genom genomförd utbildning och godkänd examination i', 'Kompetensbeviset är utfärdat av WPE Sweden AB. Det är inte en myndighetscertifiering.', 'WPE Sweden AB', 'Utbildningsansvarig'
    where not exists (select 1 from public.vihem_kp_certificate_templates where organisation_id = p_org and kind = 'competence_proof');
  insert into public.vihem_kp_site_pages (organisation_id, slug, kind, title, body, legal_review_required) values
    (p_org, 'villkor', 'terms', 'Köpvillkor', E'UTKAST – KRÄVER JURIDISK GRANSKNING INNAN PUBLICERING\n\n1. Parter\nSäljare är WPE Sweden AB.\n\n2. Beställning och betalning\nPriser anges exklusive moms för företag. Betalning sker med kort via Stripe eller, för godkända företagskunder, mot faktura.\n\n3. Digital leverans och ångerrätt\nUtbildningen levereras digitalt. Konsumenter medger vid köp att leveransen påbörjas direkt och erkänner att ångerrätten därmed kan gå förlorad när utbildningen påbörjats.\n\n4. Avbokning av kurstillfällen\nKostnadsfri avbokning är möjlig fram till den frist som anges för tillfället.\n\n5. Certifikat\nUtbildningsintyg utfärdas efter godkänd utbildning. Intyg är inte myndighetscertifiering.', true),
    (p_org, 'integritet', 'privacy', 'Integritetspolicy', E'UTKAST – KRÄVER JURIDISK GRANSKNING INNAN PUBLICERING\n\nPersonuppgiftsansvarig är WPE Sweden AB. Vi behandlar namn, e-post, utbildningsresultat och vid behov personnummer (för verifierad identitet och ID06-registrering). Personnummer lagras krypterat och används endast för angivet ändamål.', true),
    (p_org, 'angerratt', 'withdrawal', 'Ångerrätt och digital leverans', E'UTKAST – KRÄVER JURIDISK GRANSKNING INNAN PUBLICERING\n\nBeskriv ångerrätt och undantag vid digital leverans enligt distansavtalslagen.', true),
    (p_org, 'fakturavillkor', 'invoice_terms', 'Fakturavillkor', E'UTKAST – KRÄVER JURIDISK GRANSKNING INNAN PUBLICERING\n\nBetalningsvillkor enligt faktura. Dröjsmålsränta enligt räntelagen. Företagskunder måste vara godkända för fakturaköp.', true),
    (p_org, 'om-oss', 'about', 'Om Kompetensportalen', E'Kompetensportalen drivs av WPE Sweden AB. Vi erbjuder digitala och lärarledda utbildningar för bygg, entreprenad, transport, industri och säkerhet.', false)
    on conflict (organisation_id, slug) do nothing;
  insert into public.vihem_kp_faq (organisation_id, category, question, answer, sort_order)
    select p_org, 'Köp', 'Hur får jag tillgång till utbildningen?', 'När betalningen är bekräftad får du tillgång under Mina sidor. För fakturaköp gäller företagets villkor.', 1
    where not exists (select 1 from public.vihem_kp_faq where organisation_id = p_org);
end;
$$;
revoke all on function public.vihem_kp_seed_defaults(uuid) from public, anon, authenticated;
grant execute on function public.vihem_kp_seed_defaults(uuid) to service_role;

revoke all on function public.vihem_kp_session_cancel_booking(uuid, uuid, boolean), public.vihem_kp_session_rebook(uuid, uuid, uuid, boolean), public.vihem_kp_session_set_result(uuid, text, uuid, text), public.vihem_kp_waitlist_join(uuid, text, uuid),
  public.vihem_kp_session_public(uuid, uuid), public.vihem_kp_queue_email(uuid, text, text, text, jsonb, text, text, text, jsonb), public.vihem_kp_outbox_claim(integer), public.vihem_kp_outbox_result(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.vihem_kp_session_cancel_booking(uuid, uuid, boolean), public.vihem_kp_session_rebook(uuid, uuid, uuid, boolean), public.vihem_kp_session_set_result(uuid, text, uuid, text), public.vihem_kp_waitlist_join(uuid, text, uuid),
  public.vihem_kp_session_public(uuid, uuid), public.vihem_kp_queue_email(uuid, text, text, text, jsonb, text, text, text, jsonb), public.vihem_kp_outbox_claim(integer), public.vihem_kp_outbox_result(uuid, boolean, text) to service_role;

-- Schemalagd körning (utgående e-post, påminnelser, ID06) – samma mönster som övriga arbetare
create or replace function public.vihem_trigger_kp_worker() returns void
language plpgsql security definer set search_path = public, extensions, net as $$
declare cfg jsonb;
begin
  select value into cfg from public.vihem_system_settings where key = 'kp_worker';
  if cfg is null or coalesce((cfg ->> 'enabled')::boolean, false) is not true or coalesce(cfg ->> 'function_url', '') = '' or coalesce(cfg ->> 'secret', '') = '' then return; end if;
  perform net.http_post(url := cfg ->> 'function_url', headers := jsonb_build_object('Content-Type', 'application/json', 'x-vihem-kp-worker-secret', cfg ->> 'secret'),
    body := jsonb_build_object('scheduled', true, 'time', now()), timeout_milliseconds := 55000);
end;
$$;
revoke all on function public.vihem_trigger_kp_worker() from public, anon, authenticated;
create or replace function public.vihem_kp_worker_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vihem_system_settings where key = 'kp_worker' and value ->> 'secret' = p_secret and p_secret <> '');
$$;
revoke all on function public.vihem_kp_worker_secret_ok(text) from public, anon, authenticated;
grant execute on function public.vihem_kp_worker_secret_ok(text) to service_role;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'vihem-kp-worker') then perform cron.unschedule('vihem-kp-worker'); end if;
  perform cron.schedule('vihem-kp-worker', '* * * * *', $job$ SELECT public.vihem_trigger_kp_worker(); $job$);
end $$;

commit;
