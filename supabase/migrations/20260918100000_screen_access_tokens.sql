-- Lets an admin generate an unguessable link (same shape as
-- vihem_laundry_guest_links) that logs a TV in as its role='screen'
-- account, without ever typing that account's email+password on the
-- device. The token itself grants nothing on its own -- it's only ever
-- looked up by the vihem-screen-session edge function (service role),
-- which exchanges a valid one for a real, ordinary Supabase Auth session
-- for that profile, so every existing role='screen' RLS policy elsewhere
-- keeps working completely unchanged.
CREATE TABLE public.vihem_screen_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  label text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_by uuid REFERENCES public.vihem_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vihem_screen_tokens_org ON public.vihem_screen_tokens(organisation_id);
CREATE INDEX idx_vihem_screen_tokens_token ON public.vihem_screen_tokens(token);

ALTER TABLE public.vihem_screen_tokens ENABLE ROW LEVEL SECURITY;

-- Admins manage their own org's tokens directly -- create, rename, revoke
-- (toggle active) or delete -- same as vihem_laundry_guest_links. The
-- WITH CHECK also pins profile_id to an actual role='screen' profile in
-- the same org, so a token can't be pointed at an arbitrary account.
DROP POLICY IF EXISTS "VIHEM admin can manage screen tokens" ON public.vihem_screen_tokens;
CREATE POLICY "VIHEM admin can manage screen tokens" ON public.vihem_screen_tokens
  FOR ALL TO authenticated
  USING (organisation_id = get_my_org_id() AND get_my_role() IN ('admin', 'superadmin'))
  WITH CHECK (
    organisation_id = get_my_org_id()
    AND get_my_role() IN ('admin', 'superadmin')
    AND profile_id IN (SELECT id FROM public.vihem_profiles WHERE organisation_id = get_my_org_id() AND role = 'screen')
  );

NOTIFY pgrst, 'reload schema';
