-- Kompetensportalen 2.0 – del E: fakturakoppling mot Accounted (källtyper), betalningsavstämning av fakturaordrar, Stripe-händelsededuplicering.
begin;

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.vihem_accounted_customer_links'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source_type%' loop
    execute format('alter table public.vihem_accounted_customer_links drop constraint %I', c.conname);
  end loop;
  alter table public.vihem_accounted_customer_links add constraint vihem_accounted_customer_links_source_type_check
    check (source_type = any (array['tenancy', 'finance_customer', 'customer_project_customer', 'short_stay_guest', 'kp_customer']));
end $$;

create or replace function public.vihem_kp_claim_stripe_event(p_event text, p_type text, p_order uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  insert into public.vihem_kp_stripe_events (event_id, event_type, order_id) values (p_event, p_type, p_order) on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function public.vihem_kp_claim_stripe_event(text, text, uuid) from public, anon, authenticated;
grant execute on function public.vihem_kp_claim_stripe_event(text, text, uuid) to service_role;

-- Fakturastatus följer Accounted (som är det auktoritativa bokföringsflödet): betald faktura registrerar betalning och öppnar ev. låsta platser,
-- krediterad/makulerad faktura återkallar åtkomst. Körs var 5:e minut, idempotent (betalningsreferens = fakturalänkens id).
create or replace function public.vihem_kp_sync_invoice_payments() returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; v_paid integer := 0; v_cancelled integer := 0;
begin
  for o in select ord.id, ord.total, ord.amount_paid, ord.status, l.id as link_id, l.status as link_status from public.vihem_kp_orders ord join public.vihem_accounted_invoice_links l on l.id = ord.invoice_link_id
           where ord.payment_method = 'invoice' and ord.status in ('invoiced', 'fulfilled', 'paid') loop
    if o.link_status = 'paid' and o.amount_paid < o.total then
      perform public.vihem_kp_apply_payment(o.id, 'invoice', 'accounted:' || o.link_id::text, o.total, jsonb_build_object('source', 'accounted_sync'));
      update public.vihem_kp_orders set invoice_status = 'paid' where id = o.id;
      v_paid := v_paid + 1;
    elsif o.link_status in ('cancelled', 'credited') and o.status <> 'refunded' then
      perform public.vihem_kp_revoke_order_access(o.id, 'Fakturan är ' || o.link_status, null);
      update public.vihem_kp_orders set status = 'cancelled', invoice_status = o.link_status where id = o.id;
      v_cancelled := v_cancelled + 1;
    else
      update public.vihem_kp_orders set invoice_status = o.link_status where id = o.id and invoice_status is distinct from o.link_status;
    end if;
  end loop;
  return jsonb_build_object('paid', v_paid, 'cancelled', v_cancelled);
end;
$$;
revoke all on function public.vihem_kp_sync_invoice_payments() from public, anon, authenticated;
grant execute on function public.vihem_kp_sync_invoice_payments() to service_role;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'vihem-kp-sync-invoices') then perform cron.unschedule('vihem-kp-sync-invoices'); end if;
  perform cron.schedule('vihem-kp-sync-invoices', '*/5 * * * *', $job$ SELECT public.vihem_kp_sync_invoice_payments(); $job$);
end $$;


-- Boka en köpt (ej schemalagd) plats på ett kurstillfälle, med kapacitetskontroll under radlås.
create or replace function public.vihem_kp_session_book_seat(p_seat uuid, p_session uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.vihem_kp_seats%rowtype; se public.vihem_kp_sessions%rowtype; v_id uuid; e public.vihem_kp_enrollments%rowtype;
begin
  select * into s from public.vihem_kp_seats where id = p_seat for update;
  if s.id is null or not s.access_enabled or s.status in ('revoked', 'expired', 'completed') then raise exception '[E_STATE] Platsen kan inte bokas.'; end if;
  select * into se from public.vihem_kp_sessions where id = p_session for update;
  if se.id is null or se.status <> 'open' or se.starts_at <= now() or se.course_id <> s.course_id then raise exception '[E_SESSION] Kurstillfället går inte att boka.'; end if;
  if exists (select 1 from public.vihem_kp_session_bookings where seat_id = p_seat and status in ('booked', 'held', 'attended', 'passed', 'failed', 'no_show')) then raise exception '[E_STATE] Platsen är redan bokad på ett tillfälle.'; end if;
  if public.vihem_kp_session_taken(p_session) + 1 > se.capacity then raise exception '[E_FULL] Kurstillfället är fullbokat.'; end if;
  select * into e from public.vihem_kp_enrollments where seat_id = p_seat;
  insert into public.vihem_kp_session_bookings (organisation_id, session_id, order_item_id, seat_id, user_id, email, status, booked_at)
    values (s.organisation_id, p_session, s.order_item_id, p_seat, coalesce(e.user_id, s.assigned_to_user_id, s.owner_user_id), s.assigned_email, 'booked', now()) returning id into v_id;
  update public.vihem_kp_seats set session_id = p_session where id = p_seat;
  perform public.vihem_kp_audit(s.organisation_id, p_actor, 'user', 'session_booked', 'session_booking', v_id::text, jsonb_build_object('seat', p_seat));
  return v_id;
end;
$$;
revoke all on function public.vihem_kp_session_book_seat(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.vihem_kp_session_book_seat(uuid, uuid, uuid) to service_role;


-- Manuell kursplats utan avgift (support, test, kompensation): skapar en spårbar nollorder med listpris sparat på raden.
create or replace function public.vihem_kp_grant_free(p_org uuid, p_user uuid, p_customer uuid, p_product uuid, p_qty integer, p_note text, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare prod public.vihem_kp_products%rowtype; v_order uuid; v_number text; v_item uuid; v_email text;
begin
  select * into prod from public.vihem_kp_products where id = p_product and organisation_id = p_org;
  if prod.id is null or p_qty < 1 or p_qty > 500 then raise exception '[E_PRODUCT] Produkten finns inte.'; end if;
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception '[E_INVALID] Ange en orsak.'; end if;
  select email into v_email from auth.users where id = p_user;
  v_number := 'KP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.vihem_kp_order_seq')::text, 6, '0');
  insert into public.vihem_kp_orders (organisation_id, order_number, buyer_user_id, customer_id, buyer_type, status, payment_method, total, contact_email, internal_notes, terms_acceptance)
    values (p_org, v_number, p_user, p_customer, case when p_customer is null then 'private' else 'company' end, 'paid', 'free', 0, coalesce(v_email, ''), 'Manuell tilldelning: ' || p_note, jsonb_build_object('manual_grant_by', p_actor))
    returning id into v_order;
  insert into public.vihem_kp_order_items (organisation_id, order_id, product_id, course_id, description, quantity, list_price, unit_price, discount, net_total, vat_rate, vat_amount, line_total, price_label)
    values (p_org, v_order, p_product, prod.course_id, prod.name, p_qty, prod.price, 0, prod.price * p_qty, 0, prod.vat_rate, 0, 0, 'Manuell tilldelning') returning id into v_item;
  insert into public.vihem_kp_payments (organisation_id, order_id, provider, provider_ref, status, amount, paid_at, detail) values (p_org, v_order, 'manual', 'grant:' || v_order, 'succeeded', 0, now(), jsonb_build_object('note', p_note));
  perform public.vihem_kp_enable_order_access(v_order, 'manual_grant');
  perform public.vihem_kp_audit(p_org, p_actor, 'staff', 'free_seats_granted', 'order', v_order::text, jsonb_build_object('note', p_note, 'qty', p_qty));
  return v_order;
end;
$$;
revoke all on function public.vihem_kp_grant_free(uuid, uuid, uuid, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.vihem_kp_grant_free(uuid, uuid, uuid, uuid, integer, text, uuid) to service_role;

-- Personalverifierad identitet (manuell kontroll av id-handling eller BankID-resultat): markerar deltagaren och slutför väntande utbildningar.
create or replace function public.vihem_kp_verify_identity(p_user uuid, p_method text, p_actor uuid, p_note text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_org uuid; e record; v_n integer := 0;
begin
  select organisation_id into v_org from public.vihem_kp_participants where user_id = p_user;
  if v_org is null then raise exception '[E_NOT_FOUND] Deltagaren finns inte.'; end if;
  if not exists (select 1 from public.vihem_kp_participant_identity where user_id = p_user) then raise exception '[E_STATE] Deltagaren har inte lämnat något personnummer att verifiera.'; end if;
  update public.vihem_kp_participants set identity_verified_at = now(), identity_method = p_method where user_id = p_user;
  update public.vihem_kp_participant_identity set verified_at = now(), verified_method = p_method where user_id = p_user;
  perform public.vihem_kp_audit(v_org, p_actor, 'staff', 'identity_verified', 'participant', p_user::text, jsonb_build_object('method', p_method, 'note', p_note));
  for e in select id from public.vihem_kp_enrollments where user_id = p_user and status = 'awaiting_identity' loop
    perform public.vihem_kp_try_complete_enrollment(e.id); v_n := v_n + 1;
  end loop;
  update public.vihem_kp_external_registrations set status = 'pending', last_error = null, next_attempt_at = now() where user_id = p_user and status = 'needs_action' and last_error like 'Verifierat personnummer saknas%';
  return v_n;
end;
$$;
revoke all on function public.vihem_kp_verify_identity(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.vihem_kp_verify_identity(uuid, text, uuid, text) to service_role;

commit;
