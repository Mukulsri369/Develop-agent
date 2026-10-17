-- ==============================================================================
-- Migration 0013: Tenant-Specific Store Settings and Brand Configuration
-- ==============================================================================
-- Implements complete 1-to-1 store_settings entity per tenant store with:
-- 1. Full brand identity, contact, social, affiliate, content, and promotion fields
-- 2. Lossless backfill preserving Tenant 0 "Our Visible Universe" configuration
-- 3. Trigger auto-provisioning default settings for newly registered stores
-- 4. Immutable store_id enforcement trigger
-- 5. Tenant-aware RLS and secure public_store_settings view

-- 1. Ensure table structure and add expanded settings columns
CREATE TABLE IF NOT EXISTS public.store_settings (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  store_name text NOT NULL DEFAULT 'Store',
  tagline text NOT NULL DEFAULT '',
  store_description text NOT NULL DEFAULT '',
  business_category text NOT NULL DEFAULT 'general',
  logo_url text,
  favicon_url text,
  contact_email text,
  support_email text,
  support_url text,
  contact_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  instagram_url text,
  youtube_url text,
  facebook_url text,
  twitter_url text,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  affiliate_disclosure text NOT NULL DEFAULT 'When you buy through links on this site, we may earn an affiliate commission at no extra cost to you.',
  supported_retailers jsonb NOT NULL DEFAULT '[]'::jsonb,
  affiliate_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  about_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  footer_text text NOT NULL DEFAULT 'Explore the catalog. Discover extraordinary products.',
  public_policies jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_locale text NOT NULL DEFAULT 'en-US',
  currency text NOT NULL DEFAULT 'USD',
  timezone text NOT NULL DEFAULT 'UTC',
  promotions jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add any columns that might be missing if store_settings was partially initialized
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS tagline text NOT NULL DEFAULT '';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS store_description text NOT NULL DEFAULT '';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS business_category text NOT NULL DEFAULT 'general';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS favicon_url text;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS support_email text;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS support_url text;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS contact_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS youtube_url text;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS facebook_url text;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS twitter_url text;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS supported_retailers jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS affiliate_config jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS about_content jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS public_policies jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS default_locale text NOT NULL DEFAULT 'en-US';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS promotions jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Immutable store_id trigger
DROP TRIGGER IF EXISTS trg_prevent_settings_store_mutation ON public.store_settings;
CREATE TRIGGER trg_prevent_settings_store_mutation
  BEFORE UPDATE ON public.store_settings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_mutation();

-- 3. Updated_at trigger
DROP TRIGGER IF EXISTS store_settings_updated ON public.store_settings;
CREATE TRIGGER store_settings_updated
  BEFORE UPDATE ON public.store_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Auto-create default settings on new store insertion
CREATE OR REPLACE FUNCTION public.auto_create_store_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.store_settings (
    store_id,
    store_name,
    tagline,
    store_description,
    business_category,
    footer_text,
    affiliate_disclosure,
    promotions,
    feature_flags
  )
  VALUES (
    NEW.id,
    NEW.name,
    'Curated products for extraordinary minds.',
    'Discover curated items and gear from top retailers.',
    'general',
    'Explore the catalog. Discover extraordinary products.',
    'When you buy through links on this site, we may earn an affiliate commission at no extra cost to you.',
    '{"bannerEnabled": false}'::jsonb,
    '{"enable_festival": false, "enable_spotlights": true}'::jsonb
  )
  ON CONFLICT (store_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_store_settings ON public.stores;
CREATE TRIGGER trg_auto_create_store_settings
  AFTER INSERT ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_store_settings();

-- 5. Backfill and map Tenant 0 "Our Visible Universe" from legacy site_settings
DO $$
DECLARE
  v_legacy RECORD;
BEGIN
  SELECT * INTO v_legacy FROM public.site_settings WHERE id = 1;

  IF FOUND THEN
    INSERT INTO public.store_settings (
      store_id,
      store_name,
      tagline,
      store_description,
      business_category,
      logo_url,
      instagram_url,
      contact_email,
      affiliate_disclosure,
      footer_text,
      social_links,
      currency,
      timezone,
      promotions,
      feature_flags
    )
    VALUES (
      '00000000-0000-0000-0000-000000000001'::uuid,
      v_legacy.store_name,
      'Explore the universe. Discover something extraordinary.',
      'Discover astronomy-inspired products, space gear, cosmic décor, apparel and gifts curated for curious minds.',
      'astronomy',
      v_legacy.logo_url,
      v_legacy.instagram_url,
      v_legacy.contact_email,
      v_legacy.affiliate_disclosure,
      v_legacy.footer_text,
      COALESCE(v_legacy.social_links, '{}'::jsonb),
      'USD',
      'UTC',
      jsonb_build_object(
        'bannerEnabled', false,
        'festival_special', COALESCE(v_legacy.social_links->'festival_special', '{"enabled": true, "title": "Cosmic Festival Special", "eyebrow": "Celestial Curation", "description": "Handpicked celestial favorites for the festive season.", "product_ids": []}'::jsonb),
        'category_spotlights', COALESCE(v_legacy.social_links->'category_spotlights', '{}'::jsonb)
      ),
      jsonb_build_object(
        'enable_festival', true,
        'enable_spotlights', true,
        'enable_galaxy_background', true,
        'enable_reviews', false
      )
    )
    ON CONFLICT (store_id) DO UPDATE SET
      store_name = EXCLUDED.store_name,
      logo_url = EXCLUDED.logo_url,
      instagram_url = EXCLUDED.instagram_url,
      contact_email = EXCLUDED.contact_email,
      affiliate_disclosure = EXCLUDED.affiliate_disclosure,
      footer_text = EXCLUDED.footer_text,
      social_links = EXCLUDED.social_links,
      updated_at = now();
  END IF;
END $$;

-- 6. Row Level Security Policies
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.store_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_settings TO authenticated;
GRANT ALL ON public.store_settings TO service_role;

DROP POLICY IF EXISTS "Store members read settings" ON public.store_settings;
CREATE POLICY "Store members read settings" ON public.store_settings
  FOR SELECT TO authenticated
  USING (public.is_store_member(store_id));

DROP POLICY IF EXISTS "Store admins insert settings" ON public.store_settings;
CREATE POLICY "Store admins insert settings" ON public.store_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_store_admin(store_id));

DROP POLICY IF EXISTS "Store admins update settings" ON public.store_settings;
CREATE POLICY "Store admins update settings" ON public.store_settings
  FOR UPDATE TO authenticated
  USING (public.is_store_admin(store_id))
  WITH CHECK (public.is_store_admin(store_id));

DROP POLICY IF EXISTS "Store owners delete settings" ON public.store_settings;
CREATE POLICY "Store owners delete settings" ON public.store_settings
  FOR DELETE TO authenticated
  USING (public.is_store_owner(store_id));

-- 7. Public Sanitized View for storefront visitors
-- Excludes private contact_email, support_email, and internal administrative attributes
CREATE OR REPLACE VIEW public.public_store_settings
WITH (security_invoker = true)
AS
SELECT
  store_id,
  store_name,
  tagline,
  store_description,
  business_category,
  logo_url,
  favicon_url,
  support_url,
  contact_details,
  instagram_url,
  youtube_url,
  facebook_url,
  twitter_url,
  social_links,
  affiliate_disclosure,
  supported_retailers,
  about_content,
  footer_text,
  public_policies,
  default_locale,
  currency,
  timezone,
  promotions,
  feature_flags,
  updated_at
FROM public.store_settings
WHERE public.store_is_active(store_id);

GRANT SELECT ON public.public_store_settings TO anon, authenticated;
