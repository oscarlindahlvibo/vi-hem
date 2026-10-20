-- Vibogruppen: AI-tolkningar per kund och månadsvis fakturaunderlag (hosting + tilläggstjänster + AI-sidor).
--
-- Tolkningar kommer från andra system (t.ex. JK Projektlogistik) via Edge Function vihem-ai-interpret-document som
-- autentiserar med en nyckel per kund. Allt ligger i ett privat schema som klienten inte når; admin i Vibogruppens
-- organisation arbetar via RPC:erna nedan. Dokumentinnehåll sparas inte, bara metadata för fakturaunderlaget
-- (resultatet cachas högst 24 timmar så att ett omförsök efter nätverksfel inte debiteras två gånger).
CREATE SCHEMA IF NOT EXISTS vihem_vibogruppen_private;
REVOKE ALL ON SCHEMA vihem_vibogruppen_private FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS vihem_vibogruppen_private.billing_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  org_number text NOT NULL DEFAULT '' CHECK (length(org_number) <= 40),
  billing_email text NOT NULL DEFAULT '' CHECK (length(billing_email) <= 200),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  vat_rate numeric(5, 2) NOT NULL DEFAULT 25 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  -- Pris per tolkad sida, exklusive moms.
  ai_page_price numeric(12, 2) NOT NULL DEFAULT 5.00 CHECK (ai_page_price >= 0 AND ai_page_price <= 100000),
  ai_max_pages_per_request integer NOT NULL DEFAULT 10 CHECK (ai_max_pages_per_request BETWEEN 1 AND 30),
  ai_monthly_page_limit integer CHECK (ai_monthly_page_limit IS NULL OR ai_monthly_page_limit >= 0),
  ai_enabled boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vihem_vibogruppen_private.billing_price_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES vihem_vibogruppen_private.billing_customers (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('hosting', 'addon')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  unit text NOT NULL DEFAULT 'månad' CHECK (length(unit) BETWEEN 1 AND 30),
  quantity numeric(12, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0 AND unit_price <= 100000000),
  -- Återkommande poster faktureras varje månad mellan valid_from och valid_to. Engångsposter faktureras i valid_from:s månad.
  recurring boolean NOT NULL DEFAULT true,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_billing_price_items_customer ON vihem_vibogruppen_private.billing_price_items (customer_id);

CREATE TABLE IF NOT EXISTS vihem_vibogruppen_private.ai_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES vihem_vibogruppen_private.billing_customers (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  key_hint text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS vihem_vibogruppen_private.billing_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES vihem_vibogruppen_private.billing_customers (id) ON DELETE RESTRICT,
  period date NOT NULL CHECK (period = date_trunc('month', period)::date),
  status text NOT NULL CHECK (status IN ('locked', 'invoiced')),
  vat_rate numeric(5, 2) NOT NULL,
  lines jsonb NOT NULL,
  ai_interpretations integer NOT NULL DEFAULT 0,
  ai_pages integer NOT NULL DEFAULT 0,
  total_ex_vat numeric(12, 2) NOT NULL,
  vat_amount numeric(12, 2) NOT NULL,
  total_inc_vat numeric(12, 2) NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by uuid,
  invoiced_at timestamptz,
  invoiced_by uuid,
  invoice_reference text,
  UNIQUE (customer_id, period)
);

CREATE TABLE IF NOT EXISTS vihem_vibogruppen_private.ai_interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES vihem_vibogruppen_private.ai_clients (id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES vihem_vibogruppen_private.billing_customers (id) ON DELETE RESTRICT,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 100),
  source text NOT NULL DEFAULT '' CHECK (length(source) <= 100),
  user_ref text NOT NULL DEFAULT '' CHECK (length(user_ref) <= 200),
  file_name text NOT NULL DEFAULT '' CHECK (length(file_name) <= 300),
  file_sha256 text NOT NULL DEFAULT '' CHECK (file_sha256 = '' OR file_sha256 ~ '^[a-f0-9]{64}$'),
  pages integer NOT NULL CHECK (pages BETWEEN 1 AND 30),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'success', 'failed')),
  -- Endast lyckade tolkningar debiteras.
  billable boolean NOT NULL DEFAULT false,
  -- Priset per sida låses vid start, så senare prisändringar inte påverkar redan gjorda tolkningar.
  unit_price numeric(12, 2) NOT NULL,
  ai_model text NOT NULL DEFAULT '',
  ocr_provider text NOT NULL DEFAULT '',
  extraction_method text NOT NULL DEFAULT '',
  ai_call_count integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_sek numeric(12, 4) NOT NULL DEFAULT 0,
  processing_ms integer NOT NULL DEFAULT 0,
  error_message text NOT NULL DEFAULT '' CHECK (length(error_message) <= 1000),
  result jsonb,
  result_expires_at timestamptz,
  statement_id uuid REFERENCES vihem_vibogruppen_private.billing_statements (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (client_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_interpretations_customer_month ON vihem_vibogruppen_private.ai_interpretations (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_interpretations_statement ON vihem_vibogruppen_private.ai_interpretations (statement_id) WHERE statement_id IS NOT NULL;

ALTER TABLE vihem_vibogruppen_private.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vihem_vibogruppen_private.billing_price_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vihem_vibogruppen_private.ai_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE vihem_vibogruppen_private.billing_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE vihem_vibogruppen_private.ai_interpretations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA vihem_vibogruppen_private FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hjälpfunktioner (privata)
-- ---------------------------------------------------------------------------
-- Svensk kalendermånad som tidsintervall.
CREATE OR REPLACE FUNCTION vihem_vibogruppen_private.month_start(p_month date)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT (date_trunc('month', p_month)::timestamp AT TIME ZONE 'Europe/Stockholm');
$$;

CREATE OR REPLACE FUNCTION vihem_vibogruppen_private.month_end(p_month date)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT ((date_trunc('month', p_month) + interval '1 month')::timestamp AT TIME ZONE 'Europe/Stockholm');
$$;

-- Bygger fakturarader för en kund och månad: återkommande/engångsposter plus AI-sidor (grupperade per pris).
-- Rader som redan ligger i ett låst underlag räknas inte här (statement_id IS NULL).
CREATE OR REPLACE FUNCTION vihem_vibogruppen_private.billing_build(p_customer uuid, p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE
  cust vihem_vibogruppen_private.billing_customers;
  v_period date := date_trunc('month', p_month)::date;
  lines jsonb := '[]'::jsonb;
  item record;
  grp record;
  ex_vat numeric(12, 2) := 0;
  amount numeric(12, 2);
  ai_pages integer := 0;
  ai_count integer := 0;
BEGIN
  SELECT * INTO cust FROM vihem_vibogruppen_private.billing_customers WHERE id = p_customer;
  IF cust.id IS NULL THEN RAISE EXCEPTION 'Kunden hittades inte'; END IF;

  FOR item IN
    SELECT * FROM vihem_vibogruppen_private.billing_price_items
    WHERE customer_id = p_customer AND active
      AND ((recurring AND valid_from <= (v_period + interval '1 month - 1 day')::date AND (valid_to IS NULL OR valid_to >= v_period))
        OR (NOT recurring AND date_trunc('month', valid_from)::date = v_period))
    ORDER BY sort_order, created_at
  LOOP
    amount := round(item.quantity * item.unit_price, 2);
    ex_vat := ex_vat + amount;
    lines := lines || jsonb_build_object(
      'kind', item.kind, 'description', item.name, 'quantity', item.quantity, 'unit', item.unit,
      'unit_price', item.unit_price, 'amount', amount, 'price_item_id', item.id);
  END LOOP;

  FOR grp IN
    SELECT unit_price, sum(pages)::integer AS pages, count(*)::integer AS interpretations
    FROM vihem_vibogruppen_private.ai_interpretations
    WHERE customer_id = p_customer AND status = 'success' AND billable AND statement_id IS NULL
      AND created_at >= vihem_vibogruppen_private.month_start(v_period) AND created_at < vihem_vibogruppen_private.month_end(v_period)
    GROUP BY unit_price ORDER BY unit_price
  LOOP
    amount := round(grp.pages * grp.unit_price, 2);
    ex_vat := ex_vat + amount;
    ai_pages := ai_pages + grp.pages;
    ai_count := ai_count + grp.interpretations;
    lines := lines || jsonb_build_object(
      'kind', 'ai', 'description', 'AI-tolkning av dokument (' || grp.interpretations || ' st)', 'quantity', grp.pages,
      'unit', 'sida', 'unit_price', grp.unit_price, 'amount', amount);
  END LOOP;

  RETURN jsonb_build_object(
    'period', v_period, 'vat_rate', cust.vat_rate, 'lines', lines,
    'ai_interpretations', ai_count, 'ai_pages', ai_pages,
    'total_ex_vat', ex_vat, 'vat_amount', round(ex_vat * cust.vat_rate / 100, 2),
    'total_inc_vat', ex_vat + round(ex_vat * cust.vat_rate / 100, 2));
END $$;

-- Tolkningar som fastnat i "processing" mer än 10 minuter räknas som misslyckade (och debiteras inte).
CREATE OR REPLACE FUNCTION vihem_vibogruppen_private.ai_expire_stuck()
RETURNS void LANGUAGE sql SET search_path = pg_catalog AS $$
  UPDATE vihem_vibogruppen_private.ai_interpretations
  SET status = 'failed', billable = false, error_message = 'Avbröts (ingen färdig tolkning inom 10 minuter).', completed_at = now()
  WHERE status = 'processing' AND created_at < now() - interval '10 minutes';
  UPDATE vihem_vibogruppen_private.ai_interpretations SET result = NULL
  WHERE result IS NOT NULL AND result_expires_at < now();
$$;

-- ---------------------------------------------------------------------------
-- Admin-RPC:er (kräver admin i Vibogruppens organisation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_billing_overview(p_month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_period date := date_trunc('month', coalesce(p_month, current_date))::date;
  result jsonb := '[]'::jsonb;
  cust record;
  month_stats record;
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  PERFORM vihem_vibogruppen_private.ai_expire_stuck();
  FOR cust IN SELECT * FROM vihem_vibogruppen_private.billing_customers ORDER BY active DESC, name LOOP
    SELECT coalesce(sum(pages) FILTER (WHERE status = 'success' AND billable), 0)::integer AS pages,
           count(*) FILTER (WHERE status = 'success' AND billable)::integer AS interpretations,
           count(*) FILTER (WHERE status = 'failed')::integer AS failed,
           coalesce(sum(estimated_cost_sek), 0)::numeric(12, 2) AS cost
    INTO month_stats
    FROM vihem_vibogruppen_private.ai_interpretations
    WHERE customer_id = cust.id
      AND created_at >= vihem_vibogruppen_private.month_start(v_period) AND created_at < vihem_vibogruppen_private.month_end(v_period);
    result := result || jsonb_build_object(
      'customer', to_jsonb(cust),
      'clients', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'key_hint', c.key_hint, 'active', c.active, 'created_at', c.created_at, 'revoked_at', c.revoked_at, 'last_used_at', c.last_used_at) ORDER BY c.created_at)
        FROM vihem_vibogruppen_private.ai_clients c WHERE c.customer_id = cust.id), '[]'::jsonb),
      'price_items', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sort_order, p.created_at)
        FROM vihem_vibogruppen_private.billing_price_items p WHERE p.customer_id = cust.id), '[]'::jsonb),
      'month', jsonb_build_object('pages', month_stats.pages, 'interpretations', month_stats.interpretations, 'failed', month_stats.failed, 'estimated_cost_sek', month_stats.cost),
      'statement', (SELECT to_jsonb(s) - 'lines' FROM vihem_vibogruppen_private.billing_statements s WHERE s.customer_id = cust.id AND s.period = v_period));
  END LOOP;
  RETURN jsonb_build_object('period', v_period, 'customers', result);
END $$;

CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_billing_save_customer(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_id uuid := nullif(p ->> 'id', '')::uuid;
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Ogiltig kund'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO vihem_vibogruppen_private.billing_customers (name, org_number, billing_email, notes, vat_rate, ai_page_price, ai_max_pages_per_request, ai_monthly_page_limit, ai_enabled, active)
    VALUES (
      btrim(coalesce(p ->> 'name', '')), coalesce(p ->> 'org_number', ''), coalesce(p ->> 'billing_email', ''), coalesce(p ->> 'notes', ''),
      coalesce((p ->> 'vat_rate')::numeric, 25), coalesce((p ->> 'ai_page_price')::numeric, 5),
      coalesce((p ->> 'ai_max_pages_per_request')::integer, 10), nullif(p ->> 'ai_monthly_page_limit', '')::integer,
      coalesce((p ->> 'ai_enabled')::boolean, true), coalesce((p ->> 'active')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE vihem_vibogruppen_private.billing_customers SET
      name = btrim(coalesce(p ->> 'name', name)), org_number = coalesce(p ->> 'org_number', org_number),
      billing_email = coalesce(p ->> 'billing_email', billing_email), notes = coalesce(p ->> 'notes', notes),
      vat_rate = coalesce((p ->> 'vat_rate')::numeric, vat_rate), ai_page_price = coalesce((p ->> 'ai_page_price')::numeric, ai_page_price),
      ai_max_pages_per_request = coalesce((p ->> 'ai_max_pages_per_request')::integer, ai_max_pages_per_request),
      ai_monthly_page_limit = CASE WHEN p ? 'ai_monthly_page_limit' THEN nullif(p ->> 'ai_monthly_page_limit', '')::integer ELSE ai_monthly_page_limit END,
      ai_enabled = coalesce((p ->> 'ai_enabled')::boolean, ai_enabled), active = coalesce((p ->> 'active')::boolean, active),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Kunden hittades inte'; END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_billing_save_price_item(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_customer uuid := nullif(p ->> 'customer_id', '')::uuid;
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Ogiltig post'; END IF;
  IF v_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM vihem_vibogruppen_private.billing_customers WHERE id = v_customer) THEN RAISE EXCEPTION 'Kunden hittades inte'; END IF;
    INSERT INTO vihem_vibogruppen_private.billing_price_items (customer_id, kind, name, unit, quantity, unit_price, recurring, valid_from, valid_to, active, sort_order)
    VALUES (v_customer, coalesce(p ->> 'kind', 'addon'), btrim(coalesce(p ->> 'name', '')), coalesce(nullif(p ->> 'unit', ''), 'månad'),
      coalesce((p ->> 'quantity')::numeric, 1), (p ->> 'unit_price')::numeric, coalesce((p ->> 'recurring')::boolean, true),
      coalesce(nullif(p ->> 'valid_from', '')::date, current_date), nullif(p ->> 'valid_to', '')::date,
      coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort_order')::integer, 0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE vihem_vibogruppen_private.billing_price_items SET
      kind = coalesce(p ->> 'kind', kind), name = btrim(coalesce(p ->> 'name', name)), unit = coalesce(nullif(p ->> 'unit', ''), unit),
      quantity = coalesce((p ->> 'quantity')::numeric, quantity), unit_price = coalesce((p ->> 'unit_price')::numeric, unit_price),
      recurring = coalesce((p ->> 'recurring')::boolean, recurring), valid_from = coalesce(nullif(p ->> 'valid_from', '')::date, valid_from),
      valid_to = CASE WHEN p ? 'valid_to' THEN nullif(p ->> 'valid_to', '')::date ELSE valid_to END,
      active = coalesce((p ->> 'active')::boolean, active), sort_order = coalesce((p ->> 'sort_order')::integer, sort_order)
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Posten hittades inte'; END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_billing_delete_price_item(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  DELETE FROM vihem_vibogruppen_private.billing_price_items WHERE id = p_id;
END $$;

-- Skapar en API-nyckel för ett kundsystem. Nyckeln returneras EN gång; bara hashen sparas.
CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_billing_create_client(p_customer uuid, p_name text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_key text := 'vhk_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  IF NOT EXISTS (SELECT 1 FROM vihem_vibogruppen_private.billing_customers WHERE id = p_customer) THEN RAISE EXCEPTION 'Kunden hittades inte'; END IF;
  INSERT INTO vihem_vibogruppen_private.ai_clients (customer_id, name, key_hash, key_hint)
  VALUES (p_customer, btrim(coalesce(p_name, '')), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), '…' || right(v_key, 6));
  RETURN v_key;
END $$;

CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_billing_revoke_client(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  UPDATE vihem_vibogruppen_private.ai_clients SET active = false, revoked_at = now() WHERE id = p_id;
END $$;

-- Förhandsvisning/underlag för kund och månad, inklusive de enskilda tolkningarna (utan dokumentinnehåll).
CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_billing_statement(p_customer uuid, p_month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_period date := date_trunc('month', p_month)::date;
  stmt vihem_vibogruppen_private.billing_statements;
  built jsonb;
  details jsonb;
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  PERFORM vihem_vibogruppen_private.ai_expire_stuck();
  SELECT * INTO stmt FROM vihem_vibogruppen_private.billing_statements WHERE customer_id = p_customer AND billing_statements.period = v_period;
  IF stmt.id IS NOT NULL THEN
    built := jsonb_build_object(
      'period', stmt.period, 'vat_rate', stmt.vat_rate, 'lines', stmt.lines, 'ai_interpretations', stmt.ai_interpretations,
      'ai_pages', stmt.ai_pages, 'total_ex_vat', stmt.total_ex_vat, 'vat_amount', stmt.vat_amount, 'total_inc_vat', stmt.total_inc_vat);
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'created_at', i.created_at, 'source', i.source, 'user_ref', i.user_ref, 'file_name', i.file_name, 'pages', i.pages, 'unit_price', i.unit_price, 'amount', round(i.pages * i.unit_price, 2)) ORDER BY i.created_at), '[]'::jsonb)
    INTO details FROM vihem_vibogruppen_private.ai_interpretations i WHERE i.statement_id = stmt.id;
  ELSE
    built := vihem_vibogruppen_private.billing_build(p_customer, v_period);
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'created_at', i.created_at, 'source', i.source, 'user_ref', i.user_ref, 'file_name', i.file_name, 'pages', i.pages, 'unit_price', i.unit_price, 'amount', round(i.pages * i.unit_price, 2)) ORDER BY i.created_at), '[]'::jsonb)
    INTO details FROM vihem_vibogruppen_private.ai_interpretations i
    WHERE i.customer_id = p_customer AND i.status = 'success' AND i.billable AND i.statement_id IS NULL
      AND i.created_at >= vihem_vibogruppen_private.month_start(v_period) AND i.created_at < vihem_vibogruppen_private.month_end(v_period);
  END IF;
  RETURN built || jsonb_build_object(
    'customer', (SELECT to_jsonb(c) FROM vihem_vibogruppen_private.billing_customers c WHERE c.id = p_customer),
    'statement', CASE WHEN stmt.id IS NULL THEN NULL ELSE to_jsonb(stmt) - 'lines' END,
    'interpretations', details);
END $$;

-- Låser månaden: underlaget sparas som ögonblicksbild och tolkningarna knyts till det, så inget kan faktureras två gånger.
CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_billing_lock(p_customer uuid, p_month date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_period date := date_trunc('month', p_month)::date;
  built jsonb;
  v_id uuid;
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  PERFORM pg_advisory_xact_lock(hashtextextended('vibogruppen-billing:' || p_customer::text, 0));
  PERFORM vihem_vibogruppen_private.ai_expire_stuck();
  IF (date_trunc('month', p_month) + interval '1 month')::date > (now() AT TIME ZONE 'Europe/Stockholm')::date THEN
    RAISE EXCEPTION 'Månaden är inte slut. Underlaget kan låsas först efter månadsskiftet.';
  END IF;
  IF EXISTS (SELECT 1 FROM vihem_vibogruppen_private.billing_statements WHERE customer_id = p_customer AND billing_statements.period = v_period) THEN
    RAISE EXCEPTION 'Månaden är redan låst.';
  END IF;
  IF EXISTS (SELECT 1 FROM vihem_vibogruppen_private.ai_interpretations WHERE customer_id = p_customer AND status = 'processing'
             AND created_at >= vihem_vibogruppen_private.month_start(v_period) AND created_at < vihem_vibogruppen_private.month_end(v_period)) THEN
    RAISE EXCEPTION 'Det finns tolkningar under bearbetning. Försök igen om en stund.';
  END IF;
  built := vihem_vibogruppen_private.billing_build(p_customer, v_period);
  INSERT INTO vihem_vibogruppen_private.billing_statements (customer_id, period, status, vat_rate, lines, ai_interpretations, ai_pages, total_ex_vat, vat_amount, total_inc_vat, locked_by)
  VALUES (p_customer, v_period, 'locked', (built ->> 'vat_rate')::numeric, built -> 'lines', (built ->> 'ai_interpretations')::integer, (built ->> 'ai_pages')::integer,
          (built ->> 'total_ex_vat')::numeric, (built ->> 'vat_amount')::numeric, (built ->> 'total_inc_vat')::numeric, auth.uid())
  RETURNING id INTO v_id;
  UPDATE vihem_vibogruppen_private.ai_interpretations SET statement_id = v_id
  WHERE customer_id = p_customer AND status = 'success' AND billable AND statement_id IS NULL
    AND created_at >= vihem_vibogruppen_private.month_start(v_period) AND created_at < vihem_vibogruppen_private.month_end(v_period);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_billing_mark_invoiced(p_statement uuid, p_reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  IF coalesce(btrim(p_reference), '') = '' THEN RAISE EXCEPTION 'Ange fakturanummer eller referens'; END IF;
  UPDATE vihem_vibogruppen_private.billing_statements
  SET status = 'invoiced', invoiced_at = now(), invoiced_by = auth.uid(), invoice_reference = btrim(p_reference)
  WHERE id = p_statement AND status = 'locked';
  IF NOT FOUND THEN RAISE EXCEPTION 'Underlaget finns inte eller är redan fakturerat'; END IF;
END $$;

-- Öppnar ett låst (ännu inte fakturerat) underlag igen, t.ex. om priset behöver rättas.
CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_billing_unlock(p_statement uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.vihem_vibogruppen_require_admin();
  PERFORM 1 FROM vihem_vibogruppen_private.billing_statements WHERE id = p_statement AND status = 'locked' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Underlaget finns inte eller är redan fakturerat'; END IF;
  UPDATE vihem_vibogruppen_private.ai_interpretations SET statement_id = NULL WHERE statement_id = p_statement;
  DELETE FROM vihem_vibogruppen_private.billing_statements WHERE id = p_statement;
END $$;

-- ---------------------------------------------------------------------------
-- Serverfunktioner för Edge Function vihem-ai-interpret-document (endast service_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vihem_ai_client_info(p_key_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  c vihem_vibogruppen_private.ai_clients;
  cust vihem_vibogruppen_private.billing_customers;
  used integer;
BEGIN
  SELECT * INTO c FROM vihem_vibogruppen_private.ai_clients WHERE key_hash = p_key_hash AND active;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ogiltig nyckel' USING ERRCODE = '28000'; END IF;
  SELECT * INTO cust FROM vihem_vibogruppen_private.billing_customers WHERE id = c.customer_id;
  IF NOT cust.active OR NOT cust.ai_enabled THEN RAISE EXCEPTION 'AI-tolkning är avstängd för kunden' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(sum(pages), 0)::integer INTO used FROM vihem_vibogruppen_private.ai_interpretations
  WHERE customer_id = cust.id AND status IN ('success', 'processing')
    AND created_at >= vihem_vibogruppen_private.month_start(current_date) AND created_at < vihem_vibogruppen_private.month_end(current_date);
  UPDATE vihem_vibogruppen_private.ai_clients SET last_used_at = now() WHERE id = c.id;
  RETURN jsonb_build_object(
    'client_id', c.id, 'customer_id', cust.id, 'customer_name', cust.name, 'price_per_page', cust.ai_page_price, 'vat_rate', cust.vat_rate,
    'max_pages_per_request', cust.ai_max_pages_per_request, 'monthly_page_limit', cust.ai_monthly_page_limit, 'month_pages_used', used,
    'provider_organisation_id', (SELECT organisation_id FROM vihem_vibogruppen_private.site LIMIT 1));
END $$;

-- Reserverar en tolkning (idempotent per kund och request_id) och kontrollerar gränser.
CREATE OR REPLACE FUNCTION public.vihem_ai_begin(
  p_key_hash text, p_request_id text, p_pages integer, p_source text, p_user_ref text, p_file_name text, p_file_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  info jsonb;
  c_id uuid;
  cust_id uuid;
  price numeric(12, 2);
  existing vihem_vibogruppen_private.ai_interpretations;
  new_id uuid;
BEGIN
  info := public.vihem_ai_client_info(p_key_hash);
  c_id := (info ->> 'client_id')::uuid;
  cust_id := (info ->> 'customer_id')::uuid;
  price := (info ->> 'price_per_page')::numeric;
  IF coalesce(btrim(p_request_id), '') = '' OR length(p_request_id) > 100 THEN RAISE EXCEPTION 'Ogiltigt request_id' USING ERRCODE = '22023'; END IF;
  IF p_pages IS NULL OR p_pages < 1 THEN RAISE EXCEPTION 'Dokumentet saknar sidor' USING ERRCODE = '22023'; END IF;
  IF p_pages > (info ->> 'max_pages_per_request')::integer THEN
    RAISE EXCEPTION 'För många sidor (högst % per dokument)', info ->> 'max_pages_per_request' USING ERRCODE = '54000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vibogruppen-ai:' || cust_id::text, 0));
  PERFORM vihem_vibogruppen_private.ai_expire_stuck();

  SELECT * INTO existing FROM vihem_vibogruppen_private.ai_interpretations WHERE client_id = c_id AND request_id = p_request_id;
  IF existing.id IS NOT NULL THEN
    IF existing.status = 'success' THEN
      RETURN jsonb_build_object('id', existing.id, 'duplicate', true, 'status', 'success', 'pages', existing.pages, 'result', existing.result);
    ELSIF existing.status = 'processing' THEN
      RETURN jsonb_build_object('id', existing.id, 'duplicate', true, 'status', 'processing');
    END IF;
    -- Misslyckade försök är inte debiterade och får göras om med samma id.
    UPDATE vihem_vibogruppen_private.ai_interpretations
    SET status = 'processing', billable = false, pages = p_pages, unit_price = price, error_message = '', result = NULL, result_expires_at = NULL,
        created_at = now(), completed_at = NULL, source = left(coalesce(p_source, ''), 100), user_ref = left(coalesce(p_user_ref, ''), 200),
        file_name = left(coalesce(p_file_name, ''), 300), file_sha256 = coalesce(p_file_sha256, '')
    WHERE id = existing.id;
    RETURN jsonb_build_object('id', existing.id, 'duplicate', false, 'status', 'processing', 'provider_organisation_id', info -> 'provider_organisation_id');
  END IF;

  IF (info ->> 'monthly_page_limit') IS NOT NULL
     AND (info ->> 'month_pages_used')::integer + p_pages > (info ->> 'monthly_page_limit')::integer THEN
    RAISE EXCEPTION 'Månadens gräns för AI-tolkning är nådd' USING ERRCODE = '53400';
  END IF;

  INSERT INTO vihem_vibogruppen_private.ai_interpretations (client_id, customer_id, request_id, source, user_ref, file_name, file_sha256, pages, unit_price)
  VALUES (c_id, cust_id, p_request_id, left(coalesce(p_source, ''), 100), left(coalesce(p_user_ref, ''), 200), left(coalesce(p_file_name, ''), 300), coalesce(p_file_sha256, ''), p_pages, price)
  RETURNING id INTO new_id;
  RETURN jsonb_build_object('id', new_id, 'duplicate', false, 'status', 'processing', 'provider_organisation_id', info -> 'provider_organisation_id');
END $$;

-- Slutför tolkningen. Endast status 'success' debiteras. Resultatet cachas i 24 timmar för omförsök.
CREATE OR REPLACE FUNCTION public.vihem_ai_complete(
  p_id uuid, p_status text, p_result jsonb, p_model text, p_ocr_provider text, p_method text,
  p_calls integer, p_input_tokens integer, p_output_tokens integer, p_cost numeric, p_ms integer, p_error text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_status NOT IN ('success', 'failed') THEN RAISE EXCEPTION 'Ogiltig status' USING ERRCODE = '22023'; END IF;
  UPDATE vihem_vibogruppen_private.ai_interpretations SET
    status = p_status, billable = (p_status = 'success'),
    result = CASE WHEN p_status = 'success' THEN p_result ELSE NULL END,
    result_expires_at = CASE WHEN p_status = 'success' THEN now() + interval '24 hours' ELSE NULL END,
    ai_model = left(coalesce(p_model, ''), 100), ocr_provider = left(coalesce(p_ocr_provider, ''), 100), extraction_method = left(coalesce(p_method, ''), 100),
    ai_call_count = greatest(coalesce(p_calls, 0), 0), input_tokens = greatest(coalesce(p_input_tokens, 0), 0), output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
    estimated_cost_sek = greatest(coalesce(p_cost, 0), 0), processing_ms = greatest(coalesce(p_ms, 0), 0),
    error_message = left(coalesce(p_error, ''), 1000), completed_at = now()
  WHERE id = p_id AND status = 'processing';
END $$;

REVOKE ALL ON FUNCTION vihem_vibogruppen_private.month_start(date), vihem_vibogruppen_private.month_end(date), vihem_vibogruppen_private.billing_build(uuid, date), vihem_vibogruppen_private.ai_expire_stuck() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.vihem_vibogruppen_billing_overview(date), public.vihem_vibogruppen_billing_save_customer(jsonb), public.vihem_vibogruppen_billing_save_price_item(jsonb),
  public.vihem_vibogruppen_billing_delete_price_item(uuid), public.vihem_vibogruppen_billing_create_client(uuid, text), public.vihem_vibogruppen_billing_revoke_client(uuid),
  public.vihem_vibogruppen_billing_statement(uuid, date), public.vihem_vibogruppen_billing_lock(uuid, date), public.vihem_vibogruppen_billing_mark_invoiced(uuid, text),
  public.vihem_vibogruppen_billing_unlock(uuid),
  public.vihem_ai_client_info(text), public.vihem_ai_begin(text, text, integer, text, text, text, text),
  public.vihem_ai_complete(uuid, text, jsonb, text, text, text, integer, integer, integer, numeric, integer, text)
FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.vihem_vibogruppen_billing_overview(date), public.vihem_vibogruppen_billing_save_customer(jsonb), public.vihem_vibogruppen_billing_save_price_item(jsonb),
  public.vihem_vibogruppen_billing_delete_price_item(uuid), public.vihem_vibogruppen_billing_create_client(uuid, text), public.vihem_vibogruppen_billing_revoke_client(uuid),
  public.vihem_vibogruppen_billing_statement(uuid, date), public.vihem_vibogruppen_billing_lock(uuid, date), public.vihem_vibogruppen_billing_mark_invoiced(uuid, text),
  public.vihem_vibogruppen_billing_unlock(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.vihem_ai_client_info(text), public.vihem_ai_begin(text, text, integer, text, text, text, text),
  public.vihem_ai_complete(uuid, text, jsonb, text, text, text, integer, integer, integer, numeric, integer, text)
TO service_role;

NOTIFY pgrst, 'reload schema';
