-- Rättar vihem_kp_overview: GROUP BY 1 pekade på ett uttryck med aggregat ("aggregate functions are not allowed in GROUP BY"). Samma logik, gruppering på månad.
begin;
create or replace function public.vihem_kp_overview(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.get_my_org_id(); r jsonb;
begin
  if not public.vihem_kp_is_staff(v_org) then raise exception '[E_FORBIDDEN] Behörighet saknas.'; end if;
  select jsonb_build_object(
    'orders_by_month', (select coalesce(jsonb_agg(x order by x ->> 'month'), '[]'::jsonb) from (select jsonb_build_object('month', to_char(date_trunc('month', created_at), 'YYYY-MM'), 'orders', count(*), 'net', sum(total - vat_total), 'vat', sum(vat_total), 'gross', sum(total)) x
        from public.vihem_kp_orders where organisation_id = v_org and status not in ('cancelled', 'expired', 'failed') and created_at::date between p_from and p_to group by date_trunc('month', created_at)) s),
    'received_by_month', (select coalesce(jsonb_agg(x order by x ->> 'month'), '[]'::jsonb) from (select jsonb_build_object('month', to_char(date_trunc('month', paid_at), 'YYYY-MM'), 'received', sum(amount)) x
        from public.vihem_kp_payments where organisation_id = v_org and status = 'succeeded' and paid_at::date between p_from and p_to group by date_trunc('month', paid_at)) s),
    'refunded_by_month', (select coalesce(jsonb_agg(x order by x ->> 'month'), '[]'::jsonb) from (select jsonb_build_object('month', to_char(date_trunc('month', created_at), 'YYYY-MM'), 'refunded', sum(amount)) x
        from public.vihem_kp_refunds where organisation_id = v_org and created_at::date between p_from and p_to group by date_trunc('month', created_at)) s),
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
grant execute on function public.vihem_kp_overview(date, date) to authenticated;
commit;
