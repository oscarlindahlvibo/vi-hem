-- Weekly staff work-schedule board: admin plans who works on what, on
-- which days; the whole team can see it (read), only admin/superadmin can
-- create/edit/delete. Deliberately a separate planning layer rather than
-- reusing work orders'/customer projects' own assigned_to/due_date fields
-- -- admin can plan a week ahead, or drop a felanmälan on a single day,
-- without formally reassigning the underlying record or fighting its own
-- due-date logic. reference_id has no FK (same convention as
-- vihem_sms_messages.related_type/related_id, vihem_notifications) since
-- it can point at three different tables depending on entry_type.
CREATE TABLE public.vihem_schedule_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('work_order', 'maintenance_request', 'customer_project', 'note')),
  reference_id uuid,
  title text NOT NULL,
  subtitle text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_by uuid REFERENCES public.vihem_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vihem_schedule_entries_date_order CHECK (end_date >= start_date),
  CONSTRAINT vihem_schedule_entries_reference_required CHECK (
    (entry_type = 'note' AND reference_id IS NULL) OR
    (entry_type <> 'note' AND reference_id IS NOT NULL)
  )
);

CREATE INDEX idx_vihem_schedule_entries_org_dates ON public.vihem_schedule_entries(organisation_id, start_date, end_date);
CREATE INDEX idx_vihem_schedule_entries_user ON public.vihem_schedule_entries(user_id);

ALTER TABLE public.vihem_schedule_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM staff can read org schedule entries" ON public.vihem_schedule_entries;
CREATE POLICY "VIHEM staff can read org schedule entries" ON public.vihem_schedule_entries
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() IN ('staff', 'admin', 'superadmin'));

DROP POLICY IF EXISTS "VIHEM admin can manage schedule entries" ON public.vihem_schedule_entries;
CREATE POLICY "VIHEM admin can manage schedule entries" ON public.vihem_schedule_entries
  FOR ALL TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() IN ('admin', 'superadmin'))
  WITH CHECK (organisation_id = get_my_org_id() AND get_my_role() IN ('admin', 'superadmin'));

NOTIFY pgrst, 'reload schema';

-- Approved absence shown on the same board without exposing WHY --
-- vihem_staff_absence_requests RLS is deliberately strict (own rows only,
-- or admin), to protect the reason for the absence; this mirrors the same
-- narrow, intentional exception vihem_jour_absence_overlaps already
-- established for the jour dagbesked (see that migration's comment):
-- only WHEN someone is away, never absence_type/comment.
CREATE OR REPLACE FUNCTION public.vihem_schedule_absence_overlaps(
  p_from date,
  p_to date
) RETURNS TABLE(user_id uuid, start_date date, end_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.user_id, r.start_date, r.end_date
  FROM public.vihem_staff_absence_requests r
  WHERE r.organisation_id = public.get_my_org_id()
    AND r.status = 'approved'
    AND r.start_date <= p_to
    AND r.end_date >= p_from;
$$;

NOTIFY pgrst, 'reload schema';
