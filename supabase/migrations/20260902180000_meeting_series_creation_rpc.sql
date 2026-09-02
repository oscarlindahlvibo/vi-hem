-- Meetings rebuild, Phase 1 -- series creation RPC + Friday template seed.
--
-- Idempotent: calling this twice for the same organisation/week returns
-- the existing series instead of creating a duplicate (backed by the
-- UNIQUE(organisation_id, template_group_key, series_week_date) constraint
-- from the first migration -- this function just makes "get or create"
-- convenient and atomic instead of the caller needing to catch a unique
-- violation).

CREATE OR REPLACE FUNCTION public.create_or_get_friday_series(p_week_date date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_week_date date;
  v_series_id uuid;
  v_owner_meeting_id uuid;
  v_finance_meeting_id uuid;
  v_staff_meeting_id uuid;
  v_prev_series_id uuid;
  v_prev_owner_id uuid;
  v_prev_finance_id uuid;
  v_prev_staff_id uuid;
  v_template record;
  v_agenda_item jsonb;
  v_role text;
BEGIN
  v_org := vihem_get_my_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organisation for current user';
  END IF;

  IF NOT (vihem_get_my_role() = 'admin' OR vihem_get_my_role() = 'superadmin' OR vihem_has_permission(auth.uid(), 'meeting.series.manage')) THEN
    RAISE EXCEPTION 'Not authorized to manage meeting series';
  END IF;

  -- Snap to the Friday of the given (or current) week.
  v_week_date := COALESCE(p_week_date, CURRENT_DATE);
  v_week_date := v_week_date + ((5 - EXTRACT(ISODOW FROM v_week_date)::int + 7) % 7);

  SELECT id INTO v_series_id FROM vihem_meeting_series
  WHERE organisation_id = v_org AND template_group_key = 'friday_meeting' AND series_week_date = v_week_date;

  IF v_series_id IS NOT NULL THEN
    RETURN v_series_id;
  END IF;

  -- Find the previous Friday series (for previous_meeting_id chaining).
  SELECT id INTO v_prev_series_id FROM vihem_meeting_series
  WHERE organisation_id = v_org AND template_group_key = 'friday_meeting' AND series_week_date < v_week_date
  ORDER BY series_week_date DESC LIMIT 1;

  IF v_prev_series_id IS NOT NULL THEN
    SELECT id INTO v_prev_owner_id FROM vihem_meetings WHERE series_id = v_prev_series_id AND segment_key = 'owner';
    SELECT id INTO v_prev_finance_id FROM vihem_meetings WHERE series_id = v_prev_series_id AND segment_key = 'finance';
    SELECT id INTO v_prev_staff_id FROM vihem_meetings WHERE series_id = v_prev_series_id AND segment_key = 'staff';
  END IF;

  INSERT INTO vihem_meeting_series (organisation_id, template_group_key, title, series_week_date, created_by)
  VALUES (v_org, 'friday_meeting', 'Fredagsmöte ' || to_char(v_week_date, 'YYYY-MM-DD'), v_week_date, auth.uid())
  RETURNING id INTO v_series_id;

  -- owner segment
  INSERT INTO vihem_meetings (organisation_id, title, meeting_type, status, starts_at, series_id, segment_key, segment_order, previous_meeting_id, created_by)
  VALUES (v_org, 'Ägarmöte ' || to_char(v_week_date, 'YYYY-MM-DD'), 'friday_owner', 'planned', v_week_date + time '08:00', v_series_id, 'owner', 1, v_prev_owner_id, auth.uid())
  RETURNING id INTO v_owner_meeting_id;

  -- finance segment
  INSERT INTO vihem_meetings (organisation_id, title, meeting_type, status, starts_at, series_id, segment_key, segment_order, previous_meeting_id, created_by)
  VALUES (v_org, 'Ekonomi/admin ' || to_char(v_week_date, 'YYYY-MM-DD'), 'friday_finance', 'planned', v_week_date + time '08:45', v_series_id, 'finance', 2, v_prev_finance_id, auth.uid())
  RETURNING id INTO v_finance_meeting_id;

  -- staff segment
  INSERT INTO vihem_meetings (organisation_id, title, meeting_type, status, starts_at, series_id, segment_key, segment_order, previous_meeting_id, created_by)
  VALUES (v_org, 'Personalmöte ' || to_char(v_week_date, 'YYYY-MM-DD'), 'friday_staff', 'planned', v_week_date + time '09:15', v_series_id, 'staff', 3, v_prev_staff_id, auth.uid())
  RETURNING id INTO v_staff_meeting_id;

  -- Copy the active template's agenda for each segment into real agenda_items.
  FOR v_template IN
    SELECT * FROM vihem_meeting_templates
    WHERE organisation_id = v_org AND template_group_key = 'friday_meeting' AND active = true
      AND segment_key IN ('owner','finance','staff')
  LOOP
    v_role := CASE v_template.segment_key WHEN 'owner' THEN 'owner' WHEN 'finance' THEN 'finance' ELSE 'staff' END;
    FOR v_agenda_item IN SELECT * FROM jsonb_array_elements(v_template.agenda)
    LOOP
      INSERT INTO vihem_meeting_agenda_items (organisation_id, meeting_id, title, notes, sort_order, item_type, time_budget_minutes)
      VALUES (
        v_org,
        CASE v_template.segment_key WHEN 'owner' THEN v_owner_meeting_id WHEN 'finance' THEN v_finance_meeting_id ELSE v_staff_meeting_id END,
        v_agenda_item->>'title',
        COALESCE(v_agenda_item->>'notes', ''),
        COALESCE((v_agenda_item->>'sort_order')::int, 0),
        COALESCE(v_agenda_item->>'item_type', 'template'),
        (v_agenda_item->>'time_budget_minutes')::int
      );
    END LOOP;
  END LOOP;

  -- Leader is always a participant of all 3 segments; caller is recorded
  -- as leader of the segment they created the series from (owner, since
  -- the series is created from the owner meeting's start action).
  INSERT INTO vihem_meeting_segment_participants (meeting_id, user_id, role) VALUES (v_owner_meeting_id, auth.uid(), 'leader')
    ON CONFLICT (meeting_id, user_id) DO NOTHING;

  RETURN v_series_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_get_friday_series(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_or_get_friday_series(date) TO authenticated;

-- Seed the three Friday segment templates (version 1) per organisation,
-- matching the fixed agendas in spec sections 4-6. Idempotent via
-- ON CONFLICT on a partial unique index keyed to (org, group, segment,
-- version) so re-running this migration doesn't duplicate rows.
-- Not partial: NULL template_group_key/segment_key values (legacy
-- templates predating this feature) never conflict with each other or
-- with these rows under standard unique-index NULL semantics, so no WHERE
-- clause is needed and ON CONFLICT can target this index directly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vihem_meeting_templates_group_version
  ON public.vihem_meeting_templates(organisation_id, template_group_key, segment_key, version);

INSERT INTO public.vihem_meeting_templates (organisation_id, name, template_group_key, segment_key, version, agenda, active)
SELECT o.id, 'Ägarmöte', 'friday_meeting', 'owner', 1,
  '[
    {"title":"Uppföljning","item_type":"followup","sort_order":1,"time_budget_minutes":10,"notes":"Öppna beslut, åtgärder, förseningar och förra veckans prioriteringar sedan förra ägarmötet."},
    {"title":"Viktiga händelser och problem","item_type":"manual","sort_order":2,"time_budget_minutes":10,"notes":"Fastigheter, kundprojekt, hyresgäster, vandrarhem, fordon/maskiner, arbetsorder, personalfrågor, leverantörer, deadlines, risker."},
    {"title":"Ekonomi och större beslut","item_type":"manual","sort_order":3,"time_budget_minutes":10,"notes":"Endast sådant som kräver ägarbeslut -- investeringar, större inköp, offerter, likviditet, avtal."},
    {"title":"Grovplan nästa vecka","item_type":"manual","sort_order":4,"time_budget_minutes":8,"notes":"Prioriterade projekt, deadlines, resursbehov, preliminär bemanning."},
    {"title":"Vidare till ekonomi/admin och personal","item_type":"handoff_review","sort_order":5,"time_budget_minutes":7,"notes":"Markera varje punkt: endast ägare / till ekonomi/admin / till personalmötet / separat uppföljning / återkom nästa ägarmöte."}
  ]'::jsonb, true
FROM public.vihem_organisations o
ON CONFLICT (organisation_id, template_group_key, segment_key, version) DO NOTHING;

INSERT INTO public.vihem_meeting_templates (organisation_id, name, template_group_key, segment_key, version, agenda, active)
SELECT o.id, 'Ekonomi/adminmöte', 'friday_meeting', 'finance', 1,
  '[
    {"title":"Överlämnade punkter","item_type":"handoff_intake","sort_order":1,"time_budget_minutes":5,"notes":"Godkända punkter från ägarmötet -- inte ägarnas fullständiga privata anteckningar."},
    {"title":"Ekonomiska avvikelser","item_type":"manual","sort_order":2,"time_budget_minutes":8,"notes":"Obetalda fakturor, avvikelser, attestering -- endast sådant som kräver åtgärd."},
    {"title":"Saknade underlag","item_type":"missing_documents","sort_order":3,"time_budget_minutes":7,"notes":"Kvitton, tidrapporter, faktureringsunderlag -- kopplat till ansvarig/projekt/arbetsorder/deadline."},
    {"title":"Administration","item_type":"manual","sort_order":4,"time_budget_minutes":5,"notes":"Avtal, bokningar, försäkringar, myndighetsärenden, administrativa deadlines."},
    {"title":"Vidare till personalmötet","item_type":"handoff_review","sort_order":5,"time_budget_minutes":5,"notes":"Endast information personalen behöver för att agera -- neutral formulering, inga onödiga ekonomiuppgifter."}
  ]'::jsonb, true
FROM public.vihem_organisations o
ON CONFLICT (organisation_id, template_group_key, segment_key, version) DO NOTHING;

INSERT INTO public.vihem_meeting_templates (organisation_id, name, template_group_key, segment_key, version, agenda, active)
SELECT o.id, 'Personalmöte', 'friday_meeting', 'staff', 1,
  '[
    {"title":"Snabb uppföljning","item_type":"followup","sort_order":1,"time_budget_minutes":5,"notes":"Klart / inte klart / blockerad / behöver planeras om -- långa enskilda diskussioner lyfts ur som separat uppföljning."},
    {"title":"Information från ägarna","item_type":"handoff_intake","sort_order":2,"time_budget_minutes":5,"notes":"Endast godkända punkter som uttryckligen skickats till personalmötet."},
    {"title":"Underlag och återrapportering","item_type":"missing_documents","sort_order":3,"time_budget_minutes":5,"notes":"Saknade kvitton, tidrapporter -- varje punkt med ansvarig och deadline."},
    {"title":"Detaljplanering nästa vecka","item_type":"week_plan","sort_order":4,"time_budget_minutes":15,"notes":"Vad, prioriteringsordning, ansvarig, medverkande, start/slut, material, maskiner, beroenden, hinder."},
    {"title":"Personalens frågor och hinder","item_type":"manual","sort_order":5,"time_budget_minutes":8,"notes":"\"Finns det något som hindrar er från att genomföra det vi nu har planerat?\""},
    {"title":"Slutlig veckoplan","item_type":"week_plan_summary","sort_order":6,"time_budget_minutes":5,"notes":"Samlad plan: vad, ansvarig, medverkande, när, klart när, projekt/arbetsorder, hinder, material att beställa."}
  ]'::jsonb, true
FROM public.vihem_organisations o
ON CONFLICT (organisation_id, template_group_key, segment_key, version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
