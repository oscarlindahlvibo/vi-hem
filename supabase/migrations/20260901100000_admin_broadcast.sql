-- Admin-authored push/notification broadcast: an admin writes a title +
-- message and sends it to tenants, staff, or everyone in their own
-- organisation. Reuses create_notification() (20260831110000) so every
-- recipient gets a normal vihem_notifications row, which in turn triggers
-- a real push via the existing AFTER INSERT trigger (20260829100000) --
-- no separate delivery path to build or keep in sync.
--
-- This table is just a send history/audit log for the admin UI (who sent
-- what, to how many people, when) -- vihem-admin-broadcast/index.ts writes
-- to it with the service role; there is deliberately no INSERT policy for
-- authenticated clients.

CREATE TABLE IF NOT EXISTS public.vihem_admin_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  sent_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  audience text NOT NULL CHECK (audience IN ('tenant', 'staff', 'all')),
  title text NOT NULL,
  message text NOT NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vihem_admin_broadcasts_org_created
  ON public.vihem_admin_broadcasts (organisation_id, created_at DESC);

ALTER TABLE public.vihem_admin_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vihem_admin_broadcasts_select ON public.vihem_admin_broadcasts;
CREATE POLICY vihem_admin_broadcasts_select ON public.vihem_admin_broadcasts
  FOR SELECT
  USING (
    organisation_id IN (
      SELECT organisation_id FROM public.vihem_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

NOTIFY pgrst, 'reload schema';
