/*
  # Accounted V2 integration foundation

  Finance V2 architecture: Accounted (self-hosted, github.com/erp-mafia/accounted)
  becomes the source of truth for the real customer invoice, invoice number,
  invoice PDF, customer ledger, and payment status. VI-HEM stays the source of
  truth for what should be billed (rent, project time/material, short-stay,
  installment plans) and only holds a synced projection of Accounted's state.

  This migration is purely additive and does not touch any table used by the
  legacy FinancePage / vihem_invoices / vihem_accounting_integrations flow.
  Both can run side by side while Finance V2 is built out feature by feature.

  New tables:
    - vihem_accounted_company_links   organisation/company -> Accounted company
    - vihem_accounted_secrets         service-role-only encrypted API keys/webhook secrets
    - vihem_accounted_customer_links  VI-HEM customer/tenant <-> Accounted customer_id
    - vihem_accounted_invoice_links   VI-HEM billing source <-> Accounted invoice
    - vihem_accounted_webhook_subscriptions  registered outbound webhook subscriptions
    - vihem_accounted_webhook_events  inbound webhook delivery log (idempotency + audit)

  All secrets are encrypted application-side (AES-GCM, VIHEM_ACCOUNTED_SECRET_KEY)
  before being written here; RLS blocks ALL client access to vihem_accounted_secrets,
  matching the existing vihem_accounting_integration_secrets pattern.

  The four link/subscription tables are readable by users with company access
  (read model for the Finance V2 UI) but writable only by service-role Edge
  Functions: every write must go through the Accounted API first, so the
  frontend can never fabricate a "linked" or "synced" state locally.
*/

-- ---------------------------------------------------------------------------
-- Company link: which Accounted company does a VI-HEM bolag map to.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vihem_accounted_company_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.vihem_companies(id) ON DELETE CASCADE,
  accounted_base_url text NOT NULL,
  accounted_company_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  last_health_check_at timestamptz,
  last_health_status text NOT NULL DEFAULT 'unknown'
    CHECK (last_health_status IN ('unknown', 'ok', 'error')),
  last_health_error text NOT NULL DEFAULT '',
  last_sync_at timestamptz,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS vihem_accounted_company_links_org_idx
  ON public.vihem_accounted_company_links (organisation_id);

-- ---------------------------------------------------------------------------
-- Secrets: Accounted API key per company link, webhook signing secret per
-- subscription. Never readable by any client role, only service_role.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vihem_accounted_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_link_id uuid NOT NULL REFERENCES public.vihem_accounted_company_links(id) ON DELETE CASCADE,
  secret_type text NOT NULL CHECK (secret_type IN ('api_key', 'webhook_secret')),
  -- For webhook_secret rows, ties the secret to a specific subscription so
  -- rotating one event type's secret never touches another. Null for api_key.
  webhook_subscription_id uuid,
  encrypted_secret text NOT NULL,
  secret_hint text NOT NULL DEFAULT '',
  scopes text[] NOT NULL DEFAULT '{}',
  rotated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_link_id, secret_type, webhook_subscription_id)
);

CREATE INDEX IF NOT EXISTS vihem_accounted_secrets_company_link_idx
  ON public.vihem_accounted_secrets (company_link_id, secret_type);

-- ---------------------------------------------------------------------------
-- Customer link: VI-HEM customer/tenant <-> Accounted customer.
-- source_type distinguishes which local table source_id points into, so one
-- table can serve rental tenants, finance customers, and future sources
-- (customer-project customers, short-stay guests) without a new table each
-- time a new billing source is added.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vihem_accounted_customer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_link_id uuid NOT NULL REFERENCES public.vihem_accounted_company_links(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('tenancy', 'finance_customer', 'customer_project_customer', 'short_stay_guest')),
  source_id uuid NOT NULL,
  accounted_customer_id text NOT NULL,
  accounted_customer_number text NOT NULL DEFAULT '',
  sync_status text NOT NULL DEFAULT 'linked' CHECK (sync_status IN ('linked', 'stale', 'error')),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_link_id, source_type, source_id),
  UNIQUE (company_link_id, accounted_customer_id)
);

CREATE INDEX IF NOT EXISTS vihem_accounted_customer_links_org_idx
  ON public.vihem_accounted_customer_links (organisation_id);

-- ---------------------------------------------------------------------------
-- Invoice link: VI-HEM billing source <-> Accounted invoice. This is the
-- local read-model for Finance V2's "Fakturor" list; Accounted stays the
-- source of truth and this row is refreshed by webhook or explicit refresh.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vihem_accounted_invoice_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_link_id uuid NOT NULL REFERENCES public.vihem_accounted_company_links(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('rental_billing', 'customer_project', 'manual_charge')),
  source_id uuid NOT NULL,
  accounted_invoice_id text NOT NULL,
  accounted_invoice_number text,
  accounted_document_type text NOT NULL DEFAULT 'invoice',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled', 'credited')),
  currency text NOT NULL DEFAULT 'SEK',
  total numeric(14,2),
  remaining_amount numeric(14,2),
  paid_at timestamptz,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  last_sync_source text NOT NULL DEFAULT 'create' CHECK (last_sync_source IN ('create', 'webhook', 'manual_refresh')),
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_link_id, accounted_invoice_id),
  UNIQUE (company_link_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS vihem_accounted_invoice_links_org_idx
  ON public.vihem_accounted_invoice_links (organisation_id);
CREATE INDEX IF NOT EXISTS vihem_accounted_invoice_links_status_idx
  ON public.vihem_accounted_invoice_links (company_link_id, status);

-- ---------------------------------------------------------------------------
-- Webhook subscriptions: one row per (company_link, event_type) registered
-- with Accounted's POST /companies/{id}/webhooks (Accounted only supports a
-- single event_type per subscription, so covering N events needs N rows).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vihem_accounted_webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_link_id uuid NOT NULL REFERENCES public.vihem_accounted_company_links(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  accounted_webhook_id text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  last_delivery_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_link_id, event_type)
);

ALTER TABLE public.vihem_accounted_secrets
  ADD CONSTRAINT vihem_accounted_secrets_webhook_subscription_fkey
  FOREIGN KEY (webhook_subscription_id)
  REFERENCES public.vihem_accounted_webhook_subscriptions(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Inbound webhook delivery log: audit trail + idempotency backstop. The
-- handler upserts invoice/customer links by their natural key regardless
-- (safe against pure replays), but this log lets support diagnose a missed
-- or duplicated delivery after the fact and gives the reconciliation cron
-- something to compare polling results against.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vihem_accounted_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  company_link_id uuid REFERENCES public.vihem_accounted_company_links(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.vihem_accounted_webhook_subscriptions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error_message text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (company_link_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS vihem_accounted_webhook_events_company_idx
  ON public.vihem_accounted_webhook_events (company_link_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers (existing shared function).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_accounted_company_links',
    'vihem_accounted_secrets',
    'vihem_accounted_customer_links',
    'vihem_accounted_invoice_links',
    'vihem_accounted_webhook_subscriptions'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER vihem_touch_updated_at_trigger BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()',
      table_name
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- RLS. Read: company-scoped (vihem_user_has_company_access, viewer level) or
-- superadmin. Write: service_role only (USING (false) for authenticated) --
-- every mutation must go through an Edge Function that has already called
-- the Accounted API, so the frontend can never fabricate a "linked"/"synced"
-- row on its own. vihem_accounted_secrets additionally blocks ALL reads for
-- authenticated (matches vihem_accounting_integration_secrets).
-- ---------------------------------------------------------------------------

ALTER TABLE public.vihem_accounted_company_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_accounted_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_accounted_customer_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_accounted_invoice_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_accounted_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_accounted_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM accounted company links read" ON public.vihem_accounted_company_links;
CREATE POLICY "VIHEM accounted company links read"
  ON public.vihem_accounted_company_links FOR SELECT TO authenticated
  USING (
    public.vihem_get_my_role() = 'superadmin'
    OR (organisation_id = public.vihem_get_my_org_id() AND public.vihem_user_has_company_access(company_id, 'viewer'))
  );

DROP POLICY IF EXISTS "VIHEM accounted company links no client writes" ON public.vihem_accounted_company_links;
CREATE POLICY "VIHEM accounted company links no client writes"
  ON public.vihem_accounted_company_links FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "VIHEM accounted company links no client updates" ON public.vihem_accounted_company_links;
CREATE POLICY "VIHEM accounted company links no client updates"
  ON public.vihem_accounted_company_links FOR UPDATE TO authenticated USING (false);
DROP POLICY IF EXISTS "VIHEM accounted company links no client deletes" ON public.vihem_accounted_company_links;
CREATE POLICY "VIHEM accounted company links no client deletes"
  ON public.vihem_accounted_company_links FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "VIHEM accounted secrets no client access" ON public.vihem_accounted_secrets;
CREATE POLICY "VIHEM accounted secrets no client access"
  ON public.vihem_accounted_secrets FOR ALL TO authenticated USING (false) WITH CHECK (false);

DO $$
DECLARE
  table_name text;
  link_column text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vihem_accounted_customer_links',
    'vihem_accounted_invoice_links',
    'vihem_accounted_webhook_subscriptions'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM accounted links read" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "VIHEM accounted links read" ON public.%I FOR SELECT TO authenticated USING ('
      || 'public.vihem_get_my_role() = ''superadmin'' '
      || 'OR (organisation_id = public.vihem_get_my_org_id() AND EXISTS ('
      || '  SELECT 1 FROM public.vihem_accounted_company_links l'
      || '  WHERE l.id = %I.company_link_id AND public.vihem_user_has_company_access(l.company_id, ''viewer'')'
      || ')))',
      table_name, table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS "VIHEM accounted links no client insert" ON public.%I', table_name);
    EXECUTE format('CREATE POLICY "VIHEM accounted links no client insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (false)', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM accounted links no client update" ON public.%I', table_name);
    EXECUTE format('CREATE POLICY "VIHEM accounted links no client update" ON public.%I FOR UPDATE TO authenticated USING (false)', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "VIHEM accounted links no client delete" ON public.%I', table_name);
    EXECUTE format('CREATE POLICY "VIHEM accounted links no client delete" ON public.%I FOR DELETE TO authenticated USING (false)', table_name);
  END LOOP;
END $$;

-- Webhook delivery log: service-role only end to end (no UI reads it yet;
-- diagnostics happen via Supabase directly). Keeps raw event payloads,
-- which may carry customer PII, out of any client-reachable policy.
DROP POLICY IF EXISTS "VIHEM accounted webhook events no client access" ON public.vihem_accounted_webhook_events;
CREATE POLICY "VIHEM accounted webhook events no client access"
  ON public.vihem_accounted_webhook_events FOR ALL TO authenticated USING (false) WITH CHECK (false);
