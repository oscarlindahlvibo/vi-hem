-- Jour: två utökningar av bytesmarknaden.
--
-- 1. Den som annonserar ett byte kan nu annonsera ut EN DEL av sitt pass
--    (t.ex. bara torsdagen av en veckolång jour), inte bara hela passet
--    med "tillåt delning". `offer_start_at`/`offer_end_at` på annonsen
--    är den annonserade delen (NULL = hela passet, som tidigare);
--    `allow_partial` styr nu om NÅGON kan ta MINDRE än den annonserade
--    delen, inte mindre än hela passet.
-- 2. Admin kan skapa OBEMANNADE pass (vihem_jour_shifts.user_id blir
--    nullable) av valfri jourtyp, direkt öppna för byte -- helt eller
--    delvis. Plockar någon en del MITT I ett obemannat pass blir de
--    KVARVARANDE delarna INTE tilldelade någon (till skillnad från ett
--    tilldelat pass, där kvarvarande delar stannar hos ursprungspersonen)
--    -- de förblir obemannade och får AUTOMATISKT egna öppna annonser,
--    så det direkt finns två nya pass att plocka.
--
-- Klaim-triggern skrivs om till en generell brytpunktsalgoritm som
-- hanterar alla lägen (helt pass, del i början/slutet/mitten, med eller
-- utan en delvis annonserad delmängd av passet, tilldelat eller
-- obemannat) i EN sammanhållen logik istället för fyra separata fall.

ALTER TABLE public.vihem_jour_shifts ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.vihem_jour_swap_offers ADD COLUMN IF NOT EXISTS offer_start_at timestamptz;
ALTER TABLE public.vihem_jour_swap_offers ADD COLUMN IF NOT EXISTS offer_end_at timestamptz;
ALTER TABLE public.vihem_jour_swap_offers DROP CONSTRAINT IF EXISTS vihem_jour_swap_offers_offer_range_check;
ALTER TABLE public.vihem_jour_swap_offers ADD CONSTRAINT vihem_jour_swap_offers_offer_range_check
  CHECK (offer_start_at IS NULL OR offer_end_at IS NULL OR offer_end_at > offer_start_at);

-- ---- Validate the advertised sub-range at offer-creation time ----
CREATE OR REPLACE FUNCTION public.vihem_before_jour_swap_offer_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
BEGIN
  SELECT * INTO v_shift FROM public.vihem_jour_shifts WHERE id = NEW.shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Passet finns inte.';
  END IF;
  IF NEW.offer_start_at IS NOT NULL AND NEW.offer_start_at < v_shift.starts_at THEN
    RAISE EXCEPTION 'Den annonserade delen kan inte börja innan passet gör det.';
  END IF;
  IF NEW.offer_end_at IS NOT NULL AND NEW.offer_end_at > v_shift.ends_at THEN
    RAISE EXCEPTION 'Den annonserade delen kan inte sluta efter passet gör det.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vihem_before_jour_swap_offer_insert ON public.vihem_jour_swap_offers;
CREATE TRIGGER trg_vihem_before_jour_swap_offer_insert
BEFORE INSERT ON public.vihem_jour_swap_offers
FOR EACH ROW
EXECUTE FUNCTION public.vihem_before_jour_swap_offer_insert();

-- ---- Claim logic: general breakpoint split, aware of obemannade pass ----
CREATE OR REPLACE FUNCTION public.vihem_before_jour_swap_offer_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
  v_offer_start timestamptz;
  v_offer_end timestamptz;
  v_claim_start timestamptz;
  v_claim_end timestamptz;
  v_points timestamptz[];
  v_point timestamptz;
  v_prev timestamptz;
  v_new_shift_id uuid;
BEGIN
  IF NEW.status = 'claimed' THEN
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'Detta pass är inte längre tillgängligt för byte.';
    END IF;
    IF NEW.claimed_by IS NULL OR NEW.claimed_by <> auth.uid() THEN
      RAISE EXCEPTION 'Ogiltigt anspråk.';
    END IF;
    IF NEW.shift_id IS DISTINCT FROM OLD.shift_id OR NEW.offered_by IS DISTINCT FROM OLD.offered_by
       OR NEW.allow_partial IS DISTINCT FROM OLD.allow_partial
       OR NEW.offer_start_at IS DISTINCT FROM OLD.offer_start_at OR NEW.offer_end_at IS DISTINCT FROM OLD.offer_end_at THEN
      RAISE EXCEPTION 'Annonsen kan inte ändras vid ett byte.';
    END IF;

    SELECT * INTO v_shift FROM public.vihem_jour_shifts WHERE id = NEW.shift_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Passet finns inte längre.';
    END IF;
    IF v_shift.user_id IS NOT NULL AND NEW.claimed_by = v_shift.user_id THEN
      RAISE EXCEPTION 'Du kan inte ta över ditt eget pass.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.vihem_jour_eligibility e
      WHERE e.user_id = NEW.claimed_by AND e.duty_type = v_shift.duty_type AND e.active = true
    ) THEN
      RAISE EXCEPTION 'Du är inte behörig för denna jourtyp.';
    END IF;

    -- The advertised sub-range (defaults to the whole shift), clamped to
    -- the shift's own bounds regardless of what's stored.
    v_offer_start := GREATEST(v_shift.starts_at, COALESCE(OLD.offer_start_at, v_shift.starts_at));
    v_offer_end := LEAST(v_shift.ends_at, COALESCE(OLD.offer_end_at, v_shift.ends_at));
    IF v_offer_start >= v_offer_end THEN
      RAISE EXCEPTION 'Ogiltigt annonserat intervall.';
    END IF;

    v_claim_start := COALESCE(NEW.claim_start_at, v_offer_start);
    v_claim_end := COALESCE(NEW.claim_end_at, v_offer_end);
    IF v_claim_start < v_offer_start OR v_claim_end > v_offer_end OR v_claim_end <= v_claim_start THEN
      RAISE EXCEPTION 'Ogiltigt tidsintervall för bytet.';
    END IF;
    IF (v_claim_start > v_offer_start OR v_claim_end < v_offer_end) AND NOT NEW.allow_partial THEN
      RAISE EXCEPTION 'Detta pass tillåter inte att delas -- hela den annonserade delen måste tas.';
    END IF;

    NEW.claim_start_at := v_claim_start;
    NEW.claim_end_at := v_claim_end;
    NEW.claimed_at := now();

    -- General split: walk the sorted, deduplicated breakpoints
    -- (shift bounds, offered-range bounds, claimed-range bounds) and
    -- turn each resulting segment into the right kind of row:
    --  - the claimed segment -> the claimant (reuses the original row)
    --  - a leftover segment, if the shift had NO owner (obemannat) ->
    --    stays unassigned AND gets its own fresh open offer
    --    (carried-forward offered_by/allow_partial/note) -- this is what
    --    makes claiming part of an obemannat pass leave two new pass att
    --    plocka. Deliberately NOT keyed on whether the segment falls
    --    inside vs outside the advertised sub-range -- an obemannat
    --    pass has no owner to revert ANY leftover piece to, offered or
    --    not, so every leftover piece of it should stay claimable.
    --  - a leftover segment of a shift that DID have an owner -> reverts
    --    to that same owner, not re-offered (matches how a normal
    --    person-to-person swap of part of an assigned shift already
    --    worked before this migration).
    -- The original row still spans the FULL old range at this point --
    -- shrink/reassign it to just the claimed segment FIRST, before any
    -- leftover piece is inserted. Otherwise a leftover insert for the
    -- same owner (e.g. the piece before the claimed segment) would
    -- spuriously conflict with the exclude constraint against the
    -- original row's still-full old range, even though the two will
    -- never actually overlap once the split is complete.
    UPDATE public.vihem_jour_shifts
    SET user_id = NEW.claimed_by, starts_at = v_claim_start, ends_at = v_claim_end, source = 'manual', notes = 'Byte av pass', updated_at = now()
    WHERE id = v_shift.id;
    NEW.claimed_shift_id := v_shift.id;

    v_points := ARRAY(
      SELECT DISTINCT pt FROM unnest(ARRAY[v_shift.starts_at, v_offer_start, v_claim_start, v_claim_end, v_offer_end, v_shift.ends_at]) AS pt
      ORDER BY pt
    );

    v_prev := NULL;
    FOR v_point IN SELECT unnest(v_points) LOOP
      IF v_prev IS NOT NULL AND v_prev < v_point AND NOT (v_prev = v_claim_start AND v_point = v_claim_end) THEN
        IF v_shift.user_id IS NULL THEN
          INSERT INTO public.vihem_jour_shifts (organisation_id, duty_type, user_id, starts_at, ends_at, source, notes)
            VALUES (v_shift.organisation_id, v_shift.duty_type, NULL, v_prev, v_point, 'manual', 'Öppet pass')
            RETURNING id INTO v_new_shift_id;
          INSERT INTO public.vihem_jour_swap_offers (organisation_id, shift_id, offered_by, allow_partial, note, status)
            VALUES (NEW.organisation_id, v_new_shift_id, OLD.offered_by, OLD.allow_partial, OLD.note, 'open');
        ELSE
          INSERT INTO public.vihem_jour_shifts (organisation_id, duty_type, user_id, starts_at, ends_at, source, notes)
            VALUES (v_shift.organisation_id, v_shift.duty_type, v_shift.user_id, v_prev, v_point, v_shift.source, v_shift.notes);
        END IF;
      END IF;
      v_prev := v_point;
    END LOOP;

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

-- Note: the existing "Jour swap offers insert own shift" RLS policy
-- already allows admin/superadmin to create an offer for ANY shift
-- (only a non-admin offerer is required to own the shift), so an admin
-- creating an unassigned (user_id IS NULL) shift and an open offer for
-- it works with no RLS change.

NOTIFY pgrst, 'reload schema';
