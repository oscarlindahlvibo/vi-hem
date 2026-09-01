-- Drift & rutiner -- Åtkomst. The actual secret is split into its own
-- table with NO select policy for authenticated users at all --
-- vihem_access_entries (metadata, INCLUDING the non-sensitive
-- secret_hint/requires_step_up/qr_token -- a masked hint like "••32" is
-- exactly what the list view needs to render and is not itself sensitive)
-- is readable directly by any org member with access.read, but
-- vihem_access_entry_secrets holds only encrypted_secret and can only
-- ever be read by the service role (i.e. only through the
-- vihem-access-entries edge function's explicit "reveal" action, which
-- requires access.reveal and writes an audit row). This is stronger than
-- relying on the frontend to never fetch the column: even a hand-crafted
-- PostgREST request against vihem_access_entry_secrets is denied at the
-- database level, RBAC enforced on the backend as required. (Putting the
-- hint on the SAME table as the ciphertext doesn't work: RLS is row-level,
-- not column-level, so any policy that let a client read secret_hint from
-- that table would also let it read encrypted_secret from the same row.)

CREATE TABLE IF NOT EXISTS public.vihem_access_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.vihem_properties(id) ON DELETE CASCADE,
  apartment_id uuid REFERENCES public.vihem_apartments(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.vihem_companies(id) ON DELETE SET NULL,
  customer_project_id uuid REFERENCES public.vihem_customer_projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN (
    'portkod', 'dorrkod', 'grindkod', 'nyckelbox', 'hanglas', 'nyckelnummer',
    'tagg', 'larmkod', 'larm_instruktion', 'teknikrum', 'elcentral',
    'pannrum', 'forrad', 'kallare', 'vind', 'soprum', 'tvattstuga', 'garage',
    'bom_grind', 'ovrigt'
  )),
  location_note text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  comments text NOT NULL DEFAULT '',
  valid_from date,
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  secret_hint text NOT NULL DEFAULT '',
  requires_step_up boolean NOT NULL DEFAULT false,
  qr_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vihem_access_entries_target_check CHECK (
    property_id IS NOT NULL OR apartment_id IS NOT NULL OR company_id IS NOT NULL OR customer_project_id IS NOT NULL
  ),
  CONSTRAINT vihem_access_entries_qr_token_key UNIQUE (qr_token)
);

CREATE INDEX IF NOT EXISTS idx_vihem_access_entries_org ON public.vihem_access_entries (organisation_id);
CREATE INDEX IF NOT EXISTS idx_vihem_access_entries_property ON public.vihem_access_entries (property_id);
CREATE INDEX IF NOT EXISTS idx_vihem_access_entries_apartment ON public.vihem_access_entries (apartment_id);

-- Only the ciphertext -- nothing here is safe to expose via RLS to any
-- authenticated client, unlike the hint above.
CREATE TABLE IF NOT EXISTS public.vihem_access_entry_secrets (
  entry_id uuid PRIMARY KEY REFERENCES public.vihem_access_entries(id) ON DELETE CASCADE,
  encrypted_secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vihem_access_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_access_entry_secrets ENABLE ROW LEVEL SECURITY;
-- No policies at all on vihem_access_entry_secrets for the authenticated
-- role: RLS with zero matching policies denies every row to every client
-- request, service-role connections (the edge function) bypass RLS
-- entirely as usual. This is deliberate, not an oversight.

DROP POLICY IF EXISTS vihem_access_entries_select ON public.vihem_access_entries;
CREATE POLICY vihem_access_entries_select ON public.vihem_access_entries
  FOR SELECT
  USING (
    organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid())
    AND public.vihem_has_permission(auth.uid(), 'access.read')
  );

DROP POLICY IF EXISTS vihem_access_entries_manage ON public.vihem_access_entries;
CREATE POLICY vihem_access_entries_manage ON public.vihem_access_entries
  FOR ALL
  USING (
    organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid())
    AND public.vihem_has_permission(auth.uid(), 'access.manage')
  )
  WITH CHECK (
    organisation_id IN (SELECT organisation_id FROM public.vihem_profiles WHERE id = auth.uid())
    AND public.vihem_has_permission(auth.uid(), 'access.manage')
  );

-- Automatic, unbypassable audit trail for create/update/deactivate --
-- covers the "skapad/ändrad/borttagen" requirements without relying on
-- every call site remembering to log. Never logs the secret (it isn't a
-- column on this table). Reveal/copy events are logged separately by the
-- edge function, since those aren't table mutations.
CREATE OR REPLACE FUNCTION public.vihem_audit_access_entry_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
  v_org uuid;
  v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'access_entry_created';
    v_org := NEW.organisation_id;
    v_actor := NEW.created_by;
  ELSIF TG_OP = 'UPDATE' THEN
    v_event_type := CASE WHEN NEW.active = false AND OLD.active = true THEN 'access_entry_deactivated' ELSE 'access_entry_updated' END;
    v_org := NEW.organisation_id;
    v_actor := NEW.updated_by;
  ELSE
    v_event_type := 'access_entry_deleted';
    v_org := OLD.organisation_id;
    v_actor := OLD.updated_by;
  END IF;

  INSERT INTO public.vihem_audit_events (organisation_id, actor_id, event_type, entity_type, entity_id, summary, metadata)
  VALUES (
    v_org, v_actor, v_event_type, 'access_entry', COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.name, OLD.name),
    jsonb_build_object('entry_type', COALESCE(NEW.entry_type, OLD.entry_type))
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_vihem_audit_access_entry_change ON public.vihem_access_entries;
CREATE TRIGGER trg_vihem_audit_access_entry_change
  AFTER INSERT OR UPDATE OR DELETE ON public.vihem_access_entries
  FOR EACH ROW EXECUTE FUNCTION public.vihem_audit_access_entry_change();

NOTIFY pgrst, 'reload schema';
