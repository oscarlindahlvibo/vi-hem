/*
  # VI-HEM platform foundation

  Adds the shared foundation described in docs/ARCHITECTURE_ROADMAP.md:
  module entitlements, people/memberships, audit trail, files, planning,
  meetings, AI suggestions, inventory and CRM.

  The migration is append-only and VI-HEM-prefixed so it can run safely in a
  shared Supabase instance with other applications.
*/

CREATE OR REPLACE FUNCTION public.vihem_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.vihem_module_registry (
  module_key text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'core',
  default_enabled boolean NOT NULL DEFAULT false,
  default_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_organisation_modules (
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES public.vihem_module_registry(module_key) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, module_key)
);

CREATE TABLE IF NOT EXISTS public.vihem_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  person_type text NOT NULL DEFAULT 'contact'
    CHECK (person_type IN ('tenant', 'staff', 'customer', 'supplier', 'contact', 'guest', 'contractor', 'other')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.vihem_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  person_id uuid REFERENCES public.vihem_persons(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  role_key text NOT NULL DEFAULT 'staff',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'paused', 'ended')),
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, profile_id)
);

CREATE TABLE IF NOT EXISTS public.vihem_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  summary text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  bucket_id text NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL DEFAULT 0,
  owner_type text NOT NULL DEFAULT '',
  owner_id uuid,
  visibility text NOT NULL DEFAULT 'org'
    CHECK (visibility IN ('private', 'org', 'tenant', 'public')),
  uploaded_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (bucket_id, storage_path)
);

CREATE TABLE IF NOT EXISTS public.vihem_planning_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  item_type text NOT NULL DEFAULT 'custom'
    CHECK (item_type IN ('custom', 'work_order', 'inspection', 'meeting', 'absence', 'maintenance', 'project', 'inventory')),
  entity_type text NOT NULL DEFAULT '',
  entity_id uuid,
  responsible_user_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'done', 'cancelled')),
  recurrence_rule text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.vihem_meeting_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  agenda jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.vihem_meeting_templates(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  meeting_type text NOT NULL DEFAULT 'internal',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'planned', 'in_progress', 'completed', 'cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  entity_type text NOT NULL DEFAULT '',
  entity_id uuid,
  location text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_meeting_agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  responsible_user_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_meeting_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_meeting_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  decided_at timestamptz NOT NULL DEFAULT now(),
  responsible_user_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  due_date date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_meeting_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.vihem_meetings(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  responsible_user_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  due_date date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  linked_entity_type text NOT NULL DEFAULT '',
  linked_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_ai_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  feature_key text NOT NULL,
  model text NOT NULL DEFAULT '',
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost numeric(12, 4) NOT NULL DEFAULT 0,
  prompt_hash text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  source_type text NOT NULL,
  source_id uuid,
  suggestion_type text NOT NULL,
  target_type text NOT NULL DEFAULT '',
  target_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5, 4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'cancelled')),
  reviewed_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.vihem_properties(id) ON DELETE SET NULL,
  apartment_id uuid REFERENCES public.vihem_apartments(id) ON DELETE SET NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  serial_number text NOT NULL DEFAULT '',
  purchase_date date,
  warranty_until date,
  next_service_date date,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'service_due', 'out_of_service', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.vihem_inventory_service_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.vihem_inventory_items(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  performed_by text NOT NULL DEFAULT '',
  cost numeric(12, 2) NOT NULL DEFAULT 0,
  next_service_date date,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vihem_crm_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  account_type text NOT NULL DEFAULT 'customer'
    CHECK (account_type IN ('customer', 'supplier', 'partner', 'prospect', 'other')),
  organisation_number text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.vihem_crm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.vihem_crm_accounts(id) ON DELETE CASCADE,
  person_id uuid REFERENCES public.vihem_persons(id) ON DELETE SET NULL,
  name text NOT NULL,
  role_title text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.vihem_crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.vihem_crm_accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.vihem_crm_contacts(id) ON DELETE SET NULL,
  activity_type text NOT NULL DEFAULT 'note'
    CHECK (activity_type IN ('note', 'call', 'email', 'meeting', 'task', 'offer', 'agreement')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  due_at timestamptz,
  completed_at timestamptz,
  assigned_to uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.vihem_module_registry
  (module_key, name, description, category, default_enabled, default_limits, default_settings, sort_order)
VALUES
  ('properties', 'Fastigheter', 'Fastigheter, lagenheter och hyresforhallanden.', 'core', true, '{}'::jsonb, '{}'::jsonb, 10),
  ('documents', 'Dokument', 'Dokument, avtal och PDF-underlag.', 'core', true, '{}'::jsonb, '{}'::jsonb, 20),
  ('maintenance', 'Felanmälan', 'Hyresgastens felanmalan och arenden.', 'operations', true, '{}'::jsonb, '{}'::jsonb, 30),
  ('work_orders', 'Arbetsordrar', 'Interna arbetsordrar, checklistor och bilagor.', 'operations', true, '{}'::jsonb, '{}'::jsonb, 40),
  ('time_tracking', 'Tidrapportering', 'Stampelklocka, tider, franvaro och attest.', 'staff', true, '{}'::jsonb, '{}'::jsonb, 50),
  ('laundry', 'Tvättbokning', 'Tvattstugor och bokningsregler.', 'tenant', true, '{}'::jsonb, '{}'::jsonb, 60),
  ('chat', 'Chatt', 'Direktmeddelanden, gruppchattar och hyresgastdialog.', 'communication', true, '{}'::jsonb, '{}'::jsonb, 70),
  ('news', 'Nyheter', 'Nyhetsflode till hyresgaster och fastigheter.', 'communication', true, '{}'::jsonb, '{}'::jsonb, 80),
  ('purchasing', 'Inköpslista', 'Gemensamma inkop grupperade per butik.', 'operations', true, '{}'::jsonb, '{}'::jsonb, 90),
  ('customer_projects', 'Kundprojekt', 'Offerter, pagaende projekt, material och tid.', 'optional', false, '{"max_projects": 0}'::jsonb, '{}'::jsonb, 100),
  ('short_stay', 'Korttidsuthyrning', 'Airbnb, Booking och andra korttidsbokningar.', 'optional', false, '{"max_units": 0}'::jsonb, '{}'::jsonb, 110),
  ('staff_ledger', 'Personalliggare', 'Kontrollvy och kioskstampling for personal och ordningsvakter.', 'staff', false, '{}'::jsonb, '{}'::jsonb, 120),
  ('year_planning', 'Årsplanering', 'Overgripande planering och kalenderkopplade atgarder.', 'planning', false, '{}'::jsonb, '{}'::jsonb, 130),
  ('meetings', 'Möten', 'Motesmallar, agenda, beslut och uppgifter.', 'planning', false, '{}'::jsonb, '{}'::jsonb, 140),
  ('inspections', 'Besiktningar', 'Besiktningsfloden och signering.', 'operations', true, '{}'::jsonb, '{}'::jsonb, 150),
  ('inventory', 'Inventarier', 'Inventarier, serviceintervall och garantier.', 'optional', false, '{}'::jsonb, '{}'::jsonb, 160),
  ('crm', 'CRM', 'Kunder, leverantorer, kontakter och aktiviteter.', 'optional', false, '{}'::jsonb, '{}'::jsonb, 170),
  ('ai', 'AI-assistent', 'AI-forslag som alltid maste granskas av anvandare.', 'optional', false, '{}'::jsonb, '{"requires_human_approval": true}'::jsonb, 180)
ON CONFLICT (module_key) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_enabled = EXCLUDED.default_enabled,
  default_limits = EXCLUDED.default_limits,
  default_settings = EXCLUDED.default_settings,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO public.vihem_organisation_modules (organisation_id, module_key, enabled, limits, settings)
SELECT
  org.id,
  registry.module_key,
  CASE
    WHEN registry.module_key = 'customer_projects' THEN COALESCE(org.customer_projects_enabled, false)
    WHEN registry.module_key = 'short_stay' THEN COALESCE(org.short_stay_enabled, false)
    ELSE registry.default_enabled
  END AS enabled,
  CASE
    WHEN registry.module_key = 'customer_projects' THEN jsonb_build_object('max_projects', COALESCE(org.max_customer_projects, 0))
    WHEN registry.module_key = 'short_stay' THEN jsonb_build_object('max_units', COALESCE(org.max_short_stay_units, 0))
    ELSE registry.default_limits
  END AS limits,
  registry.default_settings
FROM public.vihem_organisations org
CROSS JOIN public.vihem_module_registry registry
ON CONFLICT (organisation_id, module_key) DO UPDATE
SET
  limits = CASE
    WHEN EXCLUDED.module_key IN ('customer_projects', 'short_stay') THEN EXCLUDED.limits
    ELSE public.vihem_organisation_modules.limits
  END,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.vihem_module_enabled(module_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.vihem_get_my_role() = 'superadmin'
    OR COALESCE((
      SELECT enabled
      FROM public.vihem_organisation_modules
      WHERE organisation_id = public.vihem_get_my_org_id()
        AND module_key = vihem_module_enabled.module_key
    ), false);
$$;

CREATE INDEX IF NOT EXISTS vihem_organisation_modules_module_idx ON public.vihem_organisation_modules(module_key);
CREATE INDEX IF NOT EXISTS vihem_persons_org_type_idx ON public.vihem_persons(organisation_id, person_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vihem_persons_org_email_idx ON public.vihem_persons(organisation_id, lower(email)) WHERE deleted_at IS NULL AND email <> '';
CREATE INDEX IF NOT EXISTS vihem_memberships_org_role_idx ON public.vihem_memberships(organisation_id, role_key, status);
CREATE INDEX IF NOT EXISTS vihem_memberships_profile_idx ON public.vihem_memberships(profile_id);
CREATE INDEX IF NOT EXISTS vihem_audit_events_org_created_idx ON public.vihem_audit_events(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_audit_events_entity_idx ON public.vihem_audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS vihem_files_org_owner_idx ON public.vihem_files(organisation_id, owner_type, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vihem_planning_items_org_start_idx ON public.vihem_planning_items(organisation_id, start_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vihem_meetings_org_start_idx ON public.vihem_meetings(organisation_id, starts_at);
CREATE INDEX IF NOT EXISTS vihem_meeting_agenda_items_meeting_idx ON public.vihem_meeting_agenda_items(meeting_id, sort_order);
CREATE INDEX IF NOT EXISTS vihem_meeting_notes_meeting_idx ON public.vihem_meeting_notes(meeting_id, created_at);
CREATE INDEX IF NOT EXISTS vihem_ai_suggestions_org_status_idx ON public.vihem_ai_suggestions(organisation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS vihem_inventory_items_org_property_idx ON public.vihem_inventory_items(organisation_id, property_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vihem_inventory_service_events_item_idx ON public.vihem_inventory_service_events(inventory_item_id, service_date DESC);
CREATE INDEX IF NOT EXISTS vihem_crm_accounts_org_type_idx ON public.vihem_crm_accounts(organisation_id, account_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vihem_crm_contacts_org_account_idx ON public.vihem_crm_contacts(organisation_id, account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vihem_crm_activities_org_due_idx ON public.vihem_crm_activities(organisation_id, due_at);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_module_registry',
    'vihem_organisation_modules',
    'vihem_persons',
    'vihem_memberships',
    'vihem_files',
    'vihem_planning_items',
    'vihem_meeting_templates',
    'vihem_meetings',
    'vihem_meeting_agenda_items',
    'vihem_meeting_notes',
    'vihem_meeting_decisions',
    'vihem_meeting_action_items',
    'vihem_ai_suggestions',
    'vihem_inventory_items',
    'vihem_inventory_service_events',
    'vihem_crm_accounts',
    'vihem_crm_contacts',
    'vihem_crm_activities'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()',
      table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.vihem_module_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_organisation_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_planning_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_meeting_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_meeting_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_meeting_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_meeting_action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_ai_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_ai_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_inventory_service_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_crm_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_crm_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM authenticated can read module registry" ON public.vihem_module_registry;
CREATE POLICY "VIHEM authenticated can read module registry"
  ON public.vihem_module_registry FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "VIHEM superadmins manage module registry" ON public.vihem_module_registry;
CREATE POLICY "VIHEM superadmins manage module registry"
  ON public.vihem_module_registry FOR ALL
  TO authenticated
  USING (public.vihem_get_my_role() = 'superadmin')
  WITH CHECK (public.vihem_get_my_role() = 'superadmin');

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_organisation_modules',
    'vihem_persons',
    'vihem_memberships',
    'vihem_files',
    'vihem_planning_items',
    'vihem_meeting_templates',
    'vihem_meetings',
    'vihem_meeting_agenda_items',
    'vihem_meeting_notes',
    'vihem_meeting_decisions',
    'vihem_meeting_action_items',
    'vihem_ai_interactions',
    'vihem_ai_suggestions',
    'vihem_inventory_items',
    'vihem_inventory_service_events',
    'vihem_crm_accounts',
    'vihem_crm_contacts',
    'vihem_crm_activities'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM org users can read" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM org users can read" ON public.%I FOR SELECT TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR organisation_id = public.vihem_get_my_org_id())',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM staff can insert org rows" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM staff can insert org rows" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN (''staff'', ''admin'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM staff can update org rows" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM staff can update org rows" ON public.%I FOR UPDATE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN (''staff'', ''admin''))) WITH CHECK (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN (''staff'', ''admin'')))',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM admins can delete org rows" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM admins can delete org rows" ON public.%I FOR DELETE TO authenticated USING (public.vihem_get_my_role() = ''superadmin'' OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() = ''admin''))',
      table_name
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS "VIHEM users can read own memberships" ON public.vihem_memberships;
CREATE POLICY "VIHEM users can read own memberships"
  ON public.vihem_memberships FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "VIHEM users can read own person" ON public.vihem_persons;
CREATE POLICY "VIHEM users can read own person"
  ON public.vihem_persons FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vihem_memberships m
      WHERE m.person_id = vihem_persons.id
        AND m.profile_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
