-- =============================================================================
-- Migration: 00012_i18n_translations.sql
-- Phase 38: Over-The-Air Localization (i18n) — translations Table & Strict RLS
-- =============================================================================

-- 1. Create public.translations table
CREATE TABLE IF NOT EXISTS public.translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale text NOT NULL,
  namespace text NOT NULL DEFAULT 'common',
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT translations_locale_not_empty CHECK (char_length(trim(locale)) > 0),
  CONSTRAINT translations_namespace_not_empty CHECK (char_length(trim(namespace)) > 0),
  CONSTRAINT translations_key_not_empty CHECK (char_length(trim(key)) > 0),
  CONSTRAINT translations_locale_namespace_key_unique UNIQUE (locale, namespace, key)
);

COMMENT ON TABLE public.translations IS 'Over-the-air UI localization strings managed by Super Admins across English (en), Meitei (mni), and Paite (paite).';
COMMENT ON COLUMN public.translations.locale IS 'Locale code (e.g., en, mni, paite).';
COMMENT ON COLUMN public.translations.namespace IS 'Translation namespace matching next-intl message sections (e.g., Settings, Common).';
COMMENT ON COLUMN public.translations.key IS 'Translation key within the namespace.';
COMMENT ON COLUMN public.translations.value IS 'Localized string value rendered in the UI.';

CREATE INDEX IF NOT EXISTS idx_translations_locale_namespace
  ON public.translations (locale, namespace);

-- Trigger to keep updated_at current on row updates
CREATE OR REPLACE FUNCTION public.set_translations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_translations_updated_at ON public.translations;
CREATE TRIGGER trg_translations_updated_at
  BEFORE UPDATE ON public.translations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_translations_updated_at();

-- 2. Enable Row Level Security
ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;

-- Public read access so anonymous visitors and SSR can load translations
DROP POLICY IF EXISTS "Allow public read access to translations" ON public.translations;
CREATE POLICY "Allow public read access to translations"
  ON public.translations
  FOR SELECT
  USING (true);

-- Restrict INSERT, UPDATE, and DELETE exclusively to role = 'super_admin'
DROP POLICY IF EXISTS "Allow super_admin to insert translations" ON public.translations;
CREATE POLICY "Allow super_admin to insert translations"
  ON public.translations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "Allow super_admin to update translations" ON public.translations;
CREATE POLICY "Allow super_admin to update translations"
  ON public.translations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "Allow super_admin to delete translations" ON public.translations;
CREATE POLICY "Allow super_admin to delete translations"
  ON public.translations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  );

-- 3. Seed initial Settings translations from static baseline dictionaries
INSERT INTO public.translations (locale, namespace, key, value)
VALUES
  -- English (en)
  ('en', 'Settings', 'badge', 'Workspace & Discovery Preferences'),
  ('en', 'Settings', 'title', 'Settings'),
  ('en', 'Settings', 'subtitle', 'Customize website theme appearance, language preferences, independent map styles, metric area units, and default discovery map behaviors.'),
  ('en', 'Settings', 'languageSectionTitle', 'Language'),
  ('en', 'Settings', 'languageDescription', 'Select your preferred interface language for PrintSwift Local across Churachandpur district.'),
  ('en', 'Settings', 'languageLabel', 'Display Language'),
  ('en', 'Settings', 'appearanceTitle', 'Website Appearance Mode'),
  ('en', 'Settings', 'resetTheme', 'Reset Theme'),
  ('en', 'Settings', 'mapPreferences', 'Map Preferences'),
  ('en', 'Settings', 'areaUnitTitle', 'Property & Land Area Unit (Default: Square Metres / m²)'),

  -- Meitei / Manipuri (mni)
  ('mni', 'Settings', 'badge', 'ৱার্কস্পেস অমসুং দিস্কভরি প্রিফরেন্সশিং'),
  ('mni', 'Settings', 'title', 'সেতিংশিং (Settings)'),
  ('mni', 'Settings', 'subtitle', 'ৱেবসাইত থিম, লোন (Language), মেপ স্তাইল অমসুং মেত্রিক এরিয়া ইউনিৎশিং শেমদোকপা।'),
  ('mni', 'Settings', 'languageSectionTitle', 'লোন (Language)'),
  ('mni', 'Settings', 'languageDescription', 'চুরাচান্দপুর দিস্ত্রিক্তকী প্রিন্তস্বিফ্ত লোকেলগী লোন খল্লু।'),
  ('mni', 'Settings', 'languageLabel', 'উৎফম লোন'),
  ('mni', 'Settings', 'appearanceTitle', 'ৱেবসাইত শক্লোন মোদ'),
  ('mni', 'Settings', 'resetTheme', 'থিম অমুক হন্না থম্মু'),
  ('mni', 'Settings', 'mapPreferences', 'মেপ প্রিফরেন্সশিং (Map Preferences)'),
  ('mni', 'Settings', 'areaUnitTitle', 'লম অমসুং প্রোপর্তি এরিয়া ইউনিৎ (স্কွেয়র মিতর / m²)'),

  -- Paite (paite)
  ('paite', 'Settings', 'badge', 'Workspace leh Discovery Deihdan'),
  ('paite', 'Settings', 'title', 'Settings (Thupiakna)'),
  ('paite', 'Settings', 'subtitle', 'Website melputzia, pau zatding, gamlim (Map) etdan leh gam tehna (m²) te nang deihdan in khek in.'),
  ('paite', 'Settings', 'languageSectionTitle', 'Pau (Language)'),
  ('paite', 'Settings', 'languageDescription', 'Lamka (Churachandpur) PrintSwift Local a na pau zatnop tel in.'),
  ('paite', 'Settings', 'languageLabel', 'Pau Zatding'),
  ('paite', 'Settings', 'appearanceTitle', 'Website Melputzia'),
  ('paite', 'Settings', 'resetTheme', 'Theme Ngeina Suaksakna'),
  ('paite', 'Settings', 'mapPreferences', 'Gamlim Deihdan (Map Preferences)'),
  ('paite', 'Settings', 'areaUnitTitle', 'Inmun leh Gam Tehna Unit (Default: Square Metres / m²)')
ON CONFLICT (locale, namespace, key) DO NOTHING;
