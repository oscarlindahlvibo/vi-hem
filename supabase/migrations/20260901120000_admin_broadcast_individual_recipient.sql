-- Lets an admin target a single named person instead of only a whole
-- audience group, on top of 20260901100000's group broadcast. recipient_id
-- is nullable (group sends never set it) and recipient_name is a snapshot
-- taken at send time -- the history view shouldn't change retroactively if
-- the person is later renamed or deactivated, same reasoning as the
-- denormalized *_name columns already used elsewhere (e.g.
-- tenant_signature_name on vihem_contract_signatures).

ALTER TABLE public.vihem_admin_broadcasts DROP CONSTRAINT IF EXISTS vihem_admin_broadcasts_audience_check;
ALTER TABLE public.vihem_admin_broadcasts ADD CONSTRAINT vihem_admin_broadcasts_audience_check
  CHECK (audience IN ('tenant', 'staff', 'all', 'individual'));

ALTER TABLE public.vihem_admin_broadcasts ADD COLUMN IF NOT EXISTS recipient_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.vihem_admin_broadcasts ADD COLUMN IF NOT EXISTS recipient_name text;

NOTIFY pgrst, 'reload schema';
