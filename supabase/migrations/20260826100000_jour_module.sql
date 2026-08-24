-- Jour: fastighetsjour och snöjour. En datamodell, jourtyp som fält på
-- varje pass (inte två separata system) -- en person kan ha fastighets-
-- OCH snöjour samtidigt, det är bara två rader. Dubbelbokning inom SAMMA
-- jourtyp stoppas av en riktig databas-EXCLUDE-constraint (btree_gist),
-- inte bara applikationskod. Bytesmarknaden (annonsera/plocka, helt eller
-- delat pass) körs atomärt server-side via en BEFORE UPDATE-trigger, så
-- "först till kvarn" och dubbelbokningsspärren gäller garanterat även
-- vid byten. Följer exakt samma modul-mall som
-- 20260817100000_skatteverket_module.sql.

CREATE EXTENSION IF NOT EXISTS btree_gist;

INSERT INTO public.vihem_module_registry (
  module_key, name, description, category, default_enabled, default_limits, default_settings, sort_order
)
VALUES (
  'jour',
  'Jour',
  'Fastighetsjour och snöjour -- schema, dagbesked och passbyten.',
  'staff',
  false,
  '{}'::jsonb,
  '{}'::jsonb,
  60
)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_limits = EXCLUDED.default_limits,
  default_settings = EXCLUDED.default_settings,
  updated_at = now();

INSERT INTO public.vihem_organisation_modules (organisation_id, module_key, enabled, limits, settings)
SELECT o.id, 'jour', false, r.default_limits, r.default_settings
FROM public.vihem_organisations o
JOIN public.vihem_module_registry r ON r.module_key = 'jour'
ON CONFLICT (organisation_id, module_key) DO NOTHING;

-- ---- Notifications: new 'jour' type + a settings key to allow orgs to mute it ----

ALTER TABLE public.vihem_notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.vihem_notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
      'info', 'maintenance', 'work_order', 'chat', 'message', 'laundry',
      'news', 'announcement', 'document', 'termination', 'time_entry',
      'absence', 'jour'
    )
  );

UPDATE public.vihem_organisation_notification_settings
SET settings = settings || jsonb_build_object('jour_swap_available', true)
WHERE NOT (settings ? 'jour_swap_available');

-- ---- Tables ----

CREATE TABLE IF NOT EXISTS public.vihem_jour_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  duty_type text NOT NULL CHECK (duty_type IN ('fastighet', 'sno')),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, duty_type)
);

CREATE TABLE IF NOT EXISTS public.vihem_jour_rotation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  duty_type text NOT NULL CHECK (duty_type IN ('fastighet', 'sno')),
  name text NOT NULL DEFAULT '',
  anchor_date date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One repeating cycle = the slots below in sort_order, each covering
-- duration_days, back to back, starting over from the top once the last
-- slot ends. E.g. three 7-day slots = a 21-day rotation among three people.
CREATE TABLE IF NOT EXISTS public.vihem_jour_rotation_template_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.vihem_jour_rotation_templates(id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, sort_order)
);

CREATE TABLE IF NOT EXISTS public.vihem_jour_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  duty_type text NOT NULL CHECK (duty_type IN ('fastighet', 'sno')),
  user_id uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'template')),
  rotation_template_id uuid REFERENCES public.vihem_jour_rotation_templates(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- The actual double-booking guarantee: two shifts of the SAME duty_type
-- for the SAME person can never overlap in time. Different duty_type
-- (fastighet vs sno) never conflicts -- a person can hold both at once.
-- Enforced by Postgres itself, not application code that could be
-- bypassed by a bug or a future new code path.
ALTER TABLE public.vihem_jour_shifts
  ADD CONSTRAINT vihem_jour_shifts_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    duty_type WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  );

CREATE TABLE IF NOT EXISTS public.vihem_jour_swap_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.vihem_jour_shifts(id) ON DELETE CASCADE,
  offered_by uuid NOT NULL REFERENCES public.vihem_profiles(id) ON DELETE CASCADE,
  allow_partial boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'cancelled', 'expired')),
  claimed_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  claim_start_at timestamptz,
  claim_end_at timestamptz,
  claimed_shift_id uuid REFERENCES public.vihem_jour_shifts(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vihem_jour_shifts_org_range_idx ON public.vihem_jour_shifts (organisation_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS vihem_jour_shifts_user_idx ON public.vihem_jour_shifts (user_id);
CREATE INDEX IF NOT EXISTS vihem_jour_swap_offers_org_status_idx ON public.vihem_jour_swap_offers (organisation_id, status);
CREATE INDEX IF NOT EXISTS vihem_jour_rotation_template_slots_template_idx ON public.vihem_jour_rotation_template_slots (template_id, sort_order);
CREATE INDEX IF NOT EXISTS vihem_jour_eligibility_org_type_idx ON public.vihem_jour_eligibility (organisation_id, duty_type);

DO $$
BEGIN
  IF to_regprocedure('public.vihem_touch_updated_at()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS vihem_jour_eligibility_updated_at ON public.vihem_jour_eligibility';
    EXECUTE 'CREATE TRIGGER vihem_jour_eligibility_updated_at BEFORE UPDATE ON public.vihem_jour_eligibility FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()';
    EXECUTE 'DROP TRIGGER IF EXISTS vihem_jour_rotation_templates_updated_at ON public.vihem_jour_rotation_templates';
    EXECUTE 'CREATE TRIGGER vihem_jour_rotation_templates_updated_at BEFORE UPDATE ON public.vihem_jour_rotation_templates FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()';
    EXECUTE 'DROP TRIGGER IF EXISTS vihem_jour_shifts_updated_at ON public.vihem_jour_shifts';
    EXECUTE 'CREATE TRIGGER vihem_jour_shifts_updated_at BEFORE UPDATE ON public.vihem_jour_shifts FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()';
    EXECUTE 'DROP TRIGGER IF EXISTS vihem_jour_swap_offers_updated_at ON public.vihem_jour_swap_offers';
    EXECUTE 'CREATE TRIGGER vihem_jour_swap_offers_updated_at BEFORE UPDATE ON public.vihem_jour_swap_offers FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at()';
  END IF;
END $$;

-- ---- Admin action: materialize concrete shifts from a rotation template ----
-- Idempotent -- safe to re-run for an already-covered range. Skips (via
-- the EXCLUDE constraint) any date already covered by an existing shift,
-- whether that shift came from a previous generation or a manual admin
-- edit, so a manual override is never silently clobbered by a re-run.
CREATE OR REPLACE FUNCTION public.vihem_generate_jour_shifts_from_template(
  p_template_id uuid,
  p_until_date date
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template record;
  v_cycle_length integer;
  v_cycle_start date;
  v_slot record;
  v_slot_start date;
  v_slot_end date;
  v_inserted integer := 0;
  v_cycles integer := 0;
BEGIN
  IF public.vihem_get_my_role() NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Endast admin kan generera jourpass.';
  END IF;

  SELECT * INTO v_template FROM public.vihem_jour_rotation_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mallen hittades inte.';
  END IF;
  IF public.vihem_get_my_role() <> 'superadmin' AND v_template.organisation_id <> public.vihem_get_my_org_id() THEN
    RAISE EXCEPTION 'Du saknar behörighet för denna mall.';
  END IF;

  SELECT COALESCE(SUM(duration_days), 0) INTO v_cycle_length
  FROM public.vihem_jour_rotation_template_slots
  WHERE template_id = p_template_id;
  IF v_cycle_length <= 0 THEN
    RAISE EXCEPTION 'Mallen saknar segment (person + antal dagar).';
  END IF;

  v_cycle_start := v_template.anchor_date;
  WHILE v_cycle_start < p_until_date AND v_cycles < 500 LOOP
    FOR v_slot IN
      SELECT
        user_id,
        duration_days,
        COALESCE(SUM(duration_days) OVER (ORDER BY sort_order ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::integer AS running_offset
      FROM public.vihem_jour_rotation_template_slots
      WHERE template_id = p_template_id
      ORDER BY sort_order
    LOOP
      v_slot_start := v_cycle_start + v_slot.running_offset;
      v_slot_end := v_slot_start + v_slot.duration_days;
      IF v_slot_start < p_until_date THEN
        -- Skip if ANY shift of this duty_type already overlaps this
        -- computed slot -- not just a conflict for the same user (the
        -- EXCLUDE constraint alone only catches that). A slot an admin
        -- has manually reassigned to someone else must never get a
        -- second, competing template-generated row layered on top of it.
        IF NOT EXISTS (
          SELECT 1 FROM public.vihem_jour_shifts existing
          WHERE existing.organisation_id = v_template.organisation_id
            AND existing.duty_type = v_template.duty_type
            AND tstzrange(existing.starts_at, existing.ends_at) && tstzrange(v_slot_start::timestamptz, v_slot_end::timestamptz)
        ) THEN
          BEGIN
            INSERT INTO public.vihem_jour_shifts (organisation_id, duty_type, user_id, starts_at, ends_at, source, rotation_template_id)
            VALUES (v_template.organisation_id, v_template.duty_type, v_slot.user_id, v_slot_start::timestamptz, v_slot_end::timestamptz, 'template', p_template_id);
            v_inserted := v_inserted + 1;
          EXCEPTION WHEN exclusion_violation THEN
            NULL; -- lost a race against a concurrent insert -- fine, just skip
          END;
        END IF;
      END IF;
    END LOOP;
    v_cycle_start := v_cycle_start + v_cycle_length;
    v_cycles := v_cycles + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- ---- Swap marketplace: claim/cancel business logic, enforced server-side ----
CREATE OR REPLACE FUNCTION public.vihem_before_jour_swap_offer_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF NEW.status = 'claimed' THEN
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'Detta pass är inte längre tillgängligt för byte.';
    END IF;
    IF NEW.claimed_by IS NULL OR NEW.claimed_by <> auth.uid() THEN
      RAISE EXCEPTION 'Ogiltigt anspråk.';
    END IF;
    IF NEW.shift_id IS DISTINCT FROM OLD.shift_id OR NEW.offered_by IS DISTINCT FROM OLD.offered_by OR NEW.allow_partial IS DISTINCT FROM OLD.allow_partial THEN
      RAISE EXCEPTION 'Annonsen kan inte ändras vid ett byte.';
    END IF;

    SELECT * INTO v_shift FROM public.vihem_jour_shifts WHERE id = NEW.shift_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Passet finns inte längre.';
    END IF;
    IF NEW.claimed_by = v_shift.user_id THEN
      RAISE EXCEPTION 'Du kan inte ta över ditt eget pass.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.vihem_jour_eligibility e
      WHERE e.user_id = NEW.claimed_by AND e.duty_type = v_shift.duty_type AND e.active = true
    ) THEN
      RAISE EXCEPTION 'Du är inte behörig för denna jourtyp.';
    END IF;

    v_start := COALESCE(NEW.claim_start_at, v_shift.starts_at);
    v_end := COALESCE(NEW.claim_end_at, v_shift.ends_at);
    IF v_start < v_shift.starts_at OR v_end > v_shift.ends_at OR v_end <= v_start THEN
      RAISE EXCEPTION 'Ogiltigt tidsintervall för bytet.';
    END IF;
    IF (v_start > v_shift.starts_at OR v_end < v_shift.ends_at) AND NOT NEW.allow_partial THEN
      RAISE EXCEPTION 'Detta pass tillåter inte att delas -- hela passet måste tas.';
    END IF;

    NEW.claim_start_at := v_start;
    NEW.claim_end_at := v_end;
    NEW.claimed_at := now();

    IF v_start = v_shift.starts_at AND v_end = v_shift.ends_at THEN
      UPDATE public.vihem_jour_shifts SET user_id = NEW.claimed_by, updated_at = now() WHERE id = v_shift.id;
      NEW.claimed_shift_id := v_shift.id;
    ELSIF v_start = v_shift.starts_at THEN
      UPDATE public.vihem_jour_shifts SET starts_at = v_end, updated_at = now() WHERE id = v_shift.id;
      INSERT INTO public.vihem_jour_shifts (organisation_id, duty_type, user_id, starts_at, ends_at, source, notes)
        VALUES (v_shift.organisation_id, v_shift.duty_type, NEW.claimed_by, v_start, v_end, 'manual', 'Byte av pass')
        RETURNING id INTO NEW.claimed_shift_id;
    ELSIF v_end = v_shift.ends_at THEN
      UPDATE public.vihem_jour_shifts SET ends_at = v_start, updated_at = now() WHERE id = v_shift.id;
      INSERT INTO public.vihem_jour_shifts (organisation_id, duty_type, user_id, starts_at, ends_at, source, notes)
        VALUES (v_shift.organisation_id, v_shift.duty_type, NEW.claimed_by, v_start, v_end, 'manual', 'Byte av pass')
        RETURNING id INTO NEW.claimed_shift_id;
    ELSE
      UPDATE public.vihem_jour_shifts SET ends_at = v_start, updated_at = now() WHERE id = v_shift.id;
      INSERT INTO public.vihem_jour_shifts (organisation_id, duty_type, user_id, starts_at, ends_at, source, notes)
        VALUES (v_shift.organisation_id, v_shift.duty_type, v_shift.user_id, v_end, v_shift.ends_at, 'manual', 'Kvarvarande del efter byte');
      INSERT INTO public.vihem_jour_shifts (organisation_id, duty_type, user_id, starts_at, ends_at, source, notes)
        VALUES (v_shift.organisation_id, v_shift.duty_type, NEW.claimed_by, v_start, v_end, 'manual', 'Byte av pass')
        RETURNING id INTO NEW.claimed_shift_id;
    END IF;

  ELSIF NEW.status = 'cancelled' THEN
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'Endast en öppen annons kan avbrytas.';
    END IF;
    IF auth.uid() <> OLD.offered_by AND public.vihem_get_my_role() NOT IN ('admin', 'superadmin') THEN
      RAISE EXCEPTION 'Du kan bara avbryta din egen annons.';
    END IF;

  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Ogiltig statusändring.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vihem_before_jour_swap_offer_update ON public.vihem_jour_swap_offers;
CREATE TRIGGER trg_vihem_before_jour_swap_offer_update
BEFORE UPDATE ON public.vihem_jour_swap_offers
FOR EACH ROW
EXECUTE FUNCTION public.vihem_before_jour_swap_offer_update();

CREATE OR REPLACE FUNCTION public.notify_jour_swap_offered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
  v_offerer_name text;
  v_eligible record;
  v_duty_label text;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_shift FROM public.vihem_jour_shifts WHERE id = NEW.shift_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT public.notification_enabled(NEW.organisation_id, 'jour_swap_available') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(name, email, 'Personal') INTO v_offerer_name FROM public.vihem_profiles WHERE id = NEW.offered_by;
  v_duty_label := CASE v_shift.duty_type WHEN 'fastighet' THEN 'fastighetsjour' WHEN 'sno' THEN 'snöjour' ELSE 'jour' END;

  FOR v_eligible IN
    SELECT e.user_id
    FROM public.vihem_jour_eligibility e
    WHERE e.organisation_id = NEW.organisation_id
      AND e.duty_type = v_shift.duty_type
      AND e.active = true
      AND e.user_id <> NEW.offered_by
  LOOP
    PERFORM public.create_notification(
      v_eligible.user_id,
      NEW.organisation_id,
      'Jourpass ute för byte',
      v_offerer_name || ' har lagt ut ett pass (' || v_duty_label || ') för byte.',
      'jour',
      'jour'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_jour_swap_offered ON public.vihem_jour_swap_offers;
CREATE TRIGGER trg_notify_jour_swap_offered
AFTER INSERT ON public.vihem_jour_swap_offers
FOR EACH ROW
EXECUTE FUNCTION public.notify_jour_swap_offered();

-- ---- RLS ----

ALTER TABLE public.vihem_jour_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_jour_rotation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_jour_rotation_template_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_jour_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vihem_jour_swap_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Jour eligibility admin write" ON public.vihem_jour_eligibility;
CREATE POLICY "Jour eligibility admin write" ON public.vihem_jour_eligibility
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'));

DROP POLICY IF EXISTS "Jour eligibility self read" ON public.vihem_jour_eligibility;
CREATE POLICY "Jour eligibility self read" ON public.vihem_jour_eligibility
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.vihem_module_enabled('jour'));

DROP POLICY IF EXISTS "Jour rotation templates admin" ON public.vihem_jour_rotation_templates;
CREATE POLICY "Jour rotation templates admin" ON public.vihem_jour_rotation_templates
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'));

DROP POLICY IF EXISTS "Jour rotation template slots admin" ON public.vihem_jour_rotation_template_slots;
CREATE POLICY "Jour rotation template slots admin" ON public.vihem_jour_rotation_template_slots
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.vihem_jour_rotation_templates t WHERE t.id = vihem_jour_rotation_template_slots.template_id AND t.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.vihem_jour_rotation_templates t WHERE t.id = vihem_jour_rotation_template_slots.template_id AND t.organisation_id = public.vihem_get_my_org_id()) AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'));

DROP POLICY IF EXISTS "Jour shifts org read" ON public.vihem_jour_shifts;
CREATE POLICY "Jour shifts org read" ON public.vihem_jour_shifts
  FOR SELECT TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('jour'));

DROP POLICY IF EXISTS "Jour shifts admin write" ON public.vihem_jour_shifts;
CREATE POLICY "Jour shifts admin write" ON public.vihem_jour_shifts
  FOR ALL TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'));

DROP POLICY IF EXISTS "Jour swap offers org read" ON public.vihem_jour_swap_offers;
CREATE POLICY "Jour swap offers org read" ON public.vihem_jour_swap_offers
  FOR SELECT TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('jour'));

-- Staff can offer their OWN shift for swap; admin can also do it on
-- anyone's behalf.
DROP POLICY IF EXISTS "Jour swap offers insert own shift" ON public.vihem_jour_swap_offers;
CREATE POLICY "Jour swap offers insert own shift" ON public.vihem_jour_swap_offers
  FOR INSERT TO authenticated
  WITH CHECK (
    organisation_id = public.vihem_get_my_org_id()
    AND public.vihem_module_enabled('jour')
    AND status = 'open'
    AND (
      public.vihem_get_my_role() IN ('admin', 'superadmin')
      OR (offered_by = auth.uid() AND EXISTS (SELECT 1 FROM public.vihem_jour_shifts s WHERE s.id = shift_id AND s.user_id = auth.uid()))
    )
  );

-- Broad USING/WITH CHECK -- the actual claim/cancel business logic (who's
-- allowed to do what, and the shift split/reassignment) is enforced by
-- the BEFORE UPDATE trigger above, which raises an exception (aborting
-- the whole update) on anything not allowed.
DROP POLICY IF EXISTS "Jour swap offers claim or cancel" ON public.vihem_jour_swap_offers;
CREATE POLICY "Jour swap offers claim or cancel" ON public.vihem_jour_swap_offers
  FOR UPDATE TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('jour'))
  WITH CHECK (organisation_id = public.vihem_get_my_org_id() AND public.vihem_module_enabled('jour'));

DROP POLICY IF EXISTS "Jour swap offers admin delete" ON public.vihem_jour_swap_offers;
CREATE POLICY "Jour swap offers admin delete" ON public.vihem_jour_swap_offers
  FOR DELETE TO authenticated
  USING (organisation_id = public.vihem_get_my_org_id() AND public.vihem_get_my_role() IN ('admin', 'superadmin') AND public.vihem_module_enabled('jour'));

NOTIFY pgrst, 'reload schema';
