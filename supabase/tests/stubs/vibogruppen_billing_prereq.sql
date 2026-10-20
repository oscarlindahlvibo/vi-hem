-- Minimala förutsättningar för att testa 20261022100000_vibogruppen_billing_ai.sql utan hela VI-HEM-migrationskedjan.
-- Speglar bara det som migrationen beror på (organisationer, profiler, Vibogruppens privata site-tabell och admin-kontrollen).
CREATE TABLE IF NOT EXISTS public.vihem_organisations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text);
CREATE TABLE IF NOT EXISTS public.vihem_profiles (id uuid PRIMARY KEY, organisation_id uuid REFERENCES public.vihem_organisations (id), name text, email text, role text, active boolean NOT NULL DEFAULT true);
GRANT SELECT ON public.vihem_profiles TO authenticated;
CREATE SCHEMA IF NOT EXISTS vihem_vibogruppen_private;
REVOKE ALL ON SCHEMA vihem_vibogruppen_private FROM public, anon, authenticated;
CREATE TABLE IF NOT EXISTS vihem_vibogruppen_private.site (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), organisation_id uuid NOT NULL REFERENCES public.vihem_organisations (id),
  content jsonb NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.vihem_vibogruppen_require_admin() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vihem_profiles p JOIN vihem_vibogruppen_private.site s ON s.organisation_id = p.organisation_id WHERE p.id = auth.uid() AND p.active AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.vihem_vibogruppen_require_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vihem_vibogruppen_require_admin() TO authenticated;
