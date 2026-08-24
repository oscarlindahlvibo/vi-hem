-- Jour: dagbeskedet ska kunna visa "frånvarande" (röd) för en person
-- som har jour men samtidigt är sjukanmäld/ledig, så att ett obemannat
-- läge syns direkt i schemat istället för att upptäckas i efterhand.
--
-- vihem_staff_absence_requests RLS är medvetet strikt (personal ser
-- bara sina EGNA frånvaroanmälningar, bara admin ser allas) för att
-- skydda anledningen till frånvaron. Den här funktionen läcker INTE
-- det -- bara NÄR (start/slutdatum) någon i organisationen har en
-- GODKÄND frånvaro, aldrig `absence_type`/`comment`. Det är en
-- avsiktlig, avgränsad avvikelse från den strikta RLS:en, motiverad av
-- att ett delat jourschema behöver kunna visa "ej i tjänst" för alla
-- som tittar, inte bara admin.

CREATE OR REPLACE FUNCTION public.vihem_jour_absence_overlaps(
  p_from date,
  p_to date
) RETURNS TABLE(user_id uuid, start_date date, end_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.user_id, r.start_date, r.end_date
  FROM public.vihem_staff_absence_requests r
  WHERE r.organisation_id = public.vihem_get_my_org_id()
    AND r.status = 'approved'
    AND public.vihem_module_enabled('jour')
    AND r.start_date <= p_to
    AND r.end_date >= p_from;
$$;

NOTIFY pgrst, 'reload schema';
