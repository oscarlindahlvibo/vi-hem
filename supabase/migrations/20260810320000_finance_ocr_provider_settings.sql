/*
  # OCR provider settings

  Stores encrypted OpenAI/Google Vision keys and non-sensitive scanner
  thresholds per organisation. Frontend access is blocked; admins manage it
  through Edge Functions that return only metadata/hints.
*/

CREATE TABLE IF NOT EXISTS public.vihem_ocr_provider_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.vihem_organisations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google_vision'
    CHECK (provider IN ('google_vision', 'none')),
  enabled boolean NOT NULL DEFAULT true,
  encrypted_openai_key text NOT NULL DEFAULT '',
  openai_key_hint text NOT NULL DEFAULT '',
  openai_key_rotated_at timestamptz,
  encrypted_google_vision_key text NOT NULL DEFAULT '',
  google_vision_key_hint text NOT NULL DEFAULT '',
  google_vision_key_rotated_at timestamptz,
  ai_model text NOT NULL DEFAULT 'gpt-5-nano',
  vision_model text NOT NULL DEFAULT 'gpt-5-mini',
  min_text_length integer NOT NULL DEFAULT 250 CHECK (min_text_length >= 0),
  min_confidence numeric(5,2) NOT NULL DEFAULT 0.72 CHECK (min_confidence >= 0 AND min_confidence <= 1),
  enable_vision_fallback boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.vihem_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id)
);

ALTER TABLE public.vihem_ocr_provider_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "VIHEM OCR provider settings blocked" ON public.vihem_ocr_provider_settings;
CREATE POLICY "VIHEM OCR provider settings blocked"
  ON public.vihem_ocr_provider_settings FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

DROP TRIGGER IF EXISTS vihem_touch_updated_at_trigger ON public.vihem_ocr_provider_settings;
CREATE TRIGGER vihem_touch_updated_at_trigger
  BEFORE UPDATE ON public.vihem_ocr_provider_settings
  FOR EACH ROW EXECUTE FUNCTION public.vihem_touch_updated_at();

NOTIFY pgrst, 'reload schema';
