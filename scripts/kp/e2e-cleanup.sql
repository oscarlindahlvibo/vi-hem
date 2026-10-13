-- Tar bort all E2E-testdata och återställer inställningar och sidor.
\set ON_ERROR_STOP on
begin;
create temp table e2e_courses as select id from public.vihem_kp_courses where code like 'E2E-%';
create temp table e2e_orders as select distinct o.id from public.vihem_kp_orders o left join public.vihem_kp_order_items i on i.order_id = o.id where i.course_id in (select id from e2e_courses) or o.contact_email like '%@e2e.kp.test' or o.customer_id in (select id from public.vihem_kp_customers where name like 'E2E %');
delete from public.vihem_kp_certificate_events where certificate_id in (select id from public.vihem_kp_certificates where course_id in (select id from e2e_courses));
delete from public.vihem_kp_external_registrations where certificate_id in (select id from public.vihem_kp_certificates where course_id in (select id from e2e_courses));
delete from public.vihem_kp_certificates where course_id in (select id from e2e_courses);
delete from public.vihem_kp_enrollments where course_id in (select id from e2e_courses);
delete from public.vihem_kp_session_bookings where session_id in (select id from public.vihem_kp_sessions where course_id in (select id from e2e_courses)) or order_item_id in (select id from public.vihem_kp_order_items where order_id in (select id from e2e_orders));
delete from public.vihem_kp_seats where order_id in (select id from e2e_orders) or course_id in (select id from e2e_courses);
delete from public.vihem_kp_receipts where order_id in (select id from e2e_orders);
delete from public.vihem_kp_payments where order_id in (select id from e2e_orders);
delete from public.vihem_kp_refunds where order_id in (select id from e2e_orders);
delete from public.vihem_kp_stripe_events where order_id in (select id from e2e_orders);
delete from public.vihem_kp_audit_log where entity_type = 'order' and entity_id in (select id::text from e2e_orders);
delete from public.vihem_kp_orders where id in (select id from e2e_orders);
delete from public.vihem_kp_sessions where course_id in (select id from e2e_courses);
delete from public.vihem_kp_products where course_id in (select id from e2e_courses);
delete from public.vihem_kp_course_versions where course_id in (select id from e2e_courses);
delete from public.vihem_kp_courses where id in (select id from e2e_courses);
delete from public.vihem_kp_questions where topic = 'E2E';
delete from public.vihem_kp_media_assets where storage_path like 'e2e/%';
delete from public.vihem_kp_discount_codes where code like 'E2E%';
delete from public.vihem_kp_customers where name like 'E2E %';
delete from auth.users where email like '%@e2e.kp.test';
delete from public.vihem_kp_email_outbox where to_email like '%@e2e.kp.test';
do $$
declare b jsonb; s jsonb; p jsonb;
begin
  select value into b from public.vihem_system_settings where key = 'kp_e2e_backup';
  if b is not null then
    s := b -> 'settings';
    update public.vihem_kp_settings set invoice_enabled = (s ->> 'invoice_enabled')::boolean, invoice_requires_approval = (s ->> 'invoice_requires_approval')::boolean, invoice_access_mode = s ->> 'invoice_access_mode' where organisation_id = (s ->> 'organisation_id')::uuid;
    for p in select * from jsonb_array_elements(coalesce(b -> 'pages', '[]'::jsonb)) loop
      update public.vihem_kp_site_pages set status = p ->> 'status', version = (p ->> 'version')::integer, published_at = (p ->> 'published_at')::timestamptz, legal_review_required = (p ->> 'legal_review_required')::boolean where id = (p ->> 'id')::uuid;
      delete from public.vihem_kp_site_page_versions where page_id = (p ->> 'id')::uuid and version > (p ->> 'version')::integer;
    end loop;
  end if;
  delete from public.vihem_system_settings where key in ('kp_e2e_backup', 'kp_e2e_ids');
end $$;
commit;
select 'cleanup klar: kurser=' || (select count(*) from public.vihem_kp_courses) || ' ordrar=' || (select count(*) from public.vihem_kp_orders) || ' kunder=' || (select count(*) from public.vihem_kp_customers) || ' användare=' || (select count(*) from auth.users where email like '%@e2e.kp.test');
