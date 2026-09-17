-- Group SMS: send one message to every active tenant in a property (or
-- every active tenant in the organisation) via the existing Cellsynt
-- integration (vihem_sms_settings, same send/logging pattern as
-- vihem-send-sms). This table is purely an audit/history log for the
-- broadcast itself -- each individual SMS is still logged as its own row
-- in vihem_sms_messages (related_type='sms_broadcast', related_id = this
-- row's id), same as every other related_type/related_id usage there.
CREATE TABLE public.vihem_sms_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  sent_by uuid REFERENCES public.vihem_profiles(id),
  property_id uuid REFERENCES public.vihem_properties(id) ON DELETE SET NULL,
  property_name text NOT NULL DEFAULT '', -- snapshot at send time; "Alla fastigheter" when property_id is null
  message text NOT NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vihem_sms_broadcasts_org ON public.vihem_sms_broadcasts(organisation_id, created_at DESC);

ALTER TABLE public.vihem_sms_broadcasts ENABLE ROW LEVEL SECURITY;

-- Written only by the edge function (service role) -- same convention as
-- vihem_admin_broadcasts, which has no client-facing INSERT policy either.
DROP POLICY IF EXISTS "VIHEM admin can read sms broadcasts" ON public.vihem_sms_broadcasts;
CREATE POLICY "VIHEM admin can read sms broadcasts" ON public.vihem_sms_broadcasts
  FOR SELECT TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() IN ('admin', 'superadmin'));

NOTIFY pgrst, 'reload schema';
