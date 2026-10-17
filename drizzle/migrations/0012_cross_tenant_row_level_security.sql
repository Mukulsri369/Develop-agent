-- ==============================================================================
-- Migration 0012: Complete Multi-Tenant Row Level Security & Cross-Tenant Isolation
-- ==============================================================================
-- Description:
--  1. Installs robust Security Definer authorization functions:
--     - store_is_active(uuid)
--     - product_store_id(uuid)
--     - is_store_editor(uuid)
--     - is_store_owner(uuid)
--     - Updates product_is_live(uuid) to verify store active status
--  2. Installs Anti-Tampering triggers to strictly forbid cross-tenant re-parenting:
--     - prevent_store_id_mutation() on products, categories, outbound_clicks,
--       store_domains, store_members, store_invitations, store_settings
--     - prevent_product_id_mutation() on product_images, product_features, product_tags
--     - sync_click_store_id() on outbound_clicks
--  3. Provisions multi-tenant store_settings table and public view
--  4. Rewrites and hardens RLS policies across all commerce and store entities:
--     - products (SELECT, INSERT, UPDATE, DELETE)
--     - categories (SELECT, INSERT, UPDATE, DELETE)
--     - product_images (SELECT, INSERT, UPDATE, DELETE)
--     - product_features (SELECT, INSERT, UPDATE, DELETE)
--     - product_tags (SELECT, INSERT, UPDATE, DELETE)
--     - outbound_clicks (INSERT, SELECT, DELETE)
--     - store_settings (SELECT, INSERT, UPDATE, DELETE)
--     - store_members (Restricts owner elevation & owner deletion)
--  5. Updates Storage RLS policies for tenant-partitioned object paths
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Helper Functions (SECURITY DEFINER with pinned search_path)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_is_active(check_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stores
    WHERE id = check_store_id AND status = 'active'
  );
$$;
GRANT EXECUTE ON FUNCTION public.store_is_active(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.product_store_id(_pid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT store_id FROM public.products WHERE id = _pid LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.product_store_id(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_store_editor(check_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = check_store_id
      AND user_id = auth.uid()
      AND membership_status = 'active'
      AND role IN ('owner', 'admin', 'editor')
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_store_editor(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_store_owner(check_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = check_store_id
      AND user_id = auth.uid()
      AND membership_status = 'active'
      AND role = 'owner'
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_store_owner(uuid) TO authenticated;

-- Hardened product_is_live verifying both product and parent store state
CREATE OR REPLACE FUNCTION public.product_is_live(_pid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = _pid
      AND p.active
      AND p.deleted_at IS NULL
      AND (p.store_id IS NULL OR public.store_is_active(p.store_id))
  );
$$;
GRANT EXECUTE ON FUNCTION public.product_is_live(uuid) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. Anti-Tampering Triggers (Immutability Guards)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_store_id_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.store_id IS NOT NULL AND NEW.store_id IS DISTINCT FROM OLD.store_id THEN
      RAISE EXCEPTION 'Cross-tenant mutation forbidden: store_id cannot be changed once assigned.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_product_store_mutation ON public.products;
CREATE TRIGGER trg_prevent_product_store_mutation
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_mutation();

DROP TRIGGER IF EXISTS trg_prevent_category_store_mutation ON public.categories;
CREATE TRIGGER trg_prevent_category_store_mutation
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_mutation();

DROP TRIGGER IF EXISTS trg_prevent_click_store_mutation ON public.outbound_clicks;
CREATE TRIGGER trg_prevent_click_store_mutation
  BEFORE UPDATE ON public.outbound_clicks
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_mutation();

DROP TRIGGER IF EXISTS trg_prevent_domain_store_mutation ON public.store_domains;
CREATE TRIGGER trg_prevent_domain_store_mutation
  BEFORE UPDATE ON public.store_domains
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_mutation();

DROP TRIGGER IF EXISTS trg_prevent_member_store_mutation ON public.store_members;
CREATE TRIGGER trg_prevent_member_store_mutation
  BEFORE UPDATE ON public.store_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_mutation();

CREATE OR REPLACE FUNCTION public.prevent_product_id_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.product_id IS NOT NULL AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      RAISE EXCEPTION 'Cross-product mutation forbidden: product_id cannot be changed once assigned.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_image_product_mutation ON public.product_images;
CREATE TRIGGER trg_prevent_image_product_mutation
  BEFORE UPDATE ON public.product_images
  FOR EACH ROW EXECUTE FUNCTION public.prevent_product_id_mutation();

DROP TRIGGER IF EXISTS trg_prevent_feature_product_mutation ON public.product_features;
CREATE TRIGGER trg_prevent_feature_product_mutation
  BEFORE UPDATE ON public.product_features
  FOR EACH ROW EXECUTE FUNCTION public.prevent_product_id_mutation();

DROP TRIGGER IF EXISTS trg_prevent_tag_product_mutation ON public.product_tags;
CREATE TRIGGER trg_prevent_tag_product_mutation
  BEFORE UPDATE ON public.product_tags
  FOR EACH ROW EXECUTE FUNCTION public.prevent_product_id_mutation();

-- Auto-sync outbound_clicks store_id from parent product
CREATE OR REPLACE FUNCTION public.sync_click_store_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.store_id IS NULL THEN
    NEW.store_id := public.product_store_id(NEW.product_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_click_store_id ON public.outbound_clicks;
CREATE TRIGGER trg_sync_click_store_id
  BEFORE INSERT ON public.outbound_clicks
  FOR EACH ROW EXECUTE FUNCTION public.sync_click_store_id();

-- ------------------------------------------------------------------------------
-- 3. Multi-Tenant Store Settings Table & View
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.store_settings (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  store_name text NOT NULL,
  logo_url text,
  instagram_url text,
  contact_email text,
  affiliate_disclosure text NOT NULL DEFAULT 'When you buy through links on this site, we may earn an affiliate commission at no extra cost to you.',
  footer_text text NOT NULL DEFAULT 'Explore the catalog. Discover extraordinary products.',
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency text NOT NULL DEFAULT 'USD',
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS store_settings_updated ON public.store_settings;
CREATE TRIGGER store_settings_updated
  BEFORE UPDATE ON public.store_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_prevent_settings_store_mutation ON public.store_settings;
CREATE TRIGGER trg_prevent_settings_store_mutation
  BEFORE UPDATE ON public.store_settings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_mutation();

-- Backfill Tenant 0 store_settings from legacy site_settings
INSERT INTO public.store_settings (
  store_id,
  store_name,
  logo_url,
  instagram_url,
  contact_email,
  affiliate_disclosure,
  footer_text,
  social_links
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  store_name,
  logo_url,
  instagram_url,
  contact_email,
  affiliate_disclosure,
  footer_text,
  social_links
FROM public.site_settings
WHERE id = 1
ON CONFLICT (store_id) DO NOTHING;

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

-- Public sanitized view for visitor storefronts (contact_email omitted)
CREATE OR REPLACE VIEW public.public_store_settings
WITH (security_invoker = true)
AS
SELECT
  store_id,
  store_name,
  logo_url,
  instagram_url,
  affiliate_disclosure,
  footer_text,
  social_links,
  currency,
  timezone,
  updated_at
FROM public.store_settings
WHERE public.store_is_active(store_id);

GRANT SELECT ON public.public_store_settings TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Products RLS Policies (Tenant-Isolated)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Public reads live products" ON public.products;
DROP POLICY IF EXISTS "Admins insert products" ON public.products;
DROP POLICY IF EXISTS "Admins update products" ON public.products;
DROP POLICY IF EXISTS "Admins delete products" ON public.products;

CREATE POLICY "Public and members read products" ON public.products
  FOR SELECT TO anon, authenticated
  USING (
    (active AND deleted_at IS NULL AND (store_id IS NULL OR public.store_is_active(store_id)))
    OR (store_id IS NOT NULL AND public.is_store_member(store_id))
    OR public.is_super_admin()
  );

CREATE POLICY "Store editors insert draft products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id IS NOT NULL AND (
      public.is_store_admin(store_id)
      OR (public.is_store_editor(store_id) AND active = false)
    )
  );

CREATE POLICY "Store editors update products" ON public.products
  FOR UPDATE TO authenticated
  USING (
    store_id IS NOT NULL AND public.is_store_editor(store_id)
  )
  WITH CHECK (
    store_id IS NOT NULL AND (
      public.is_store_admin(store_id)
      OR (public.is_store_editor(store_id) AND active = false)
    )
  );

CREATE POLICY "Store admins delete products" ON public.products
  FOR DELETE TO authenticated
  USING (
    store_id IS NOT NULL AND public.is_store_admin(store_id)
  );

-- ------------------------------------------------------------------------------
-- 5. Categories RLS Policies (Tenant-Isolated)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Public reads active categories" ON public.categories;
DROP POLICY IF EXISTS "Admins insert categories" ON public.categories;
DROP POLICY IF EXISTS "Admins update categories" ON public.categories;
DROP POLICY IF EXISTS "Admins delete categories" ON public.categories;

CREATE POLICY "Public and members read categories" ON public.categories
  FOR SELECT TO anon, authenticated
  USING (
    (active AND (store_id IS NULL OR public.store_is_active(store_id)))
    OR (store_id IS NOT NULL AND public.is_store_member(store_id))
    OR public.is_super_admin()
  );

CREATE POLICY "Store admins insert categories" ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id IS NOT NULL AND public.is_store_admin(store_id)
  );

CREATE POLICY "Store admins update categories" ON public.categories
  FOR UPDATE TO authenticated
  USING (
    store_id IS NOT NULL AND public.is_store_admin(store_id)
  )
  WITH CHECK (
    store_id IS NOT NULL AND public.is_store_admin(store_id)
  );

CREATE POLICY "Store admins delete categories" ON public.categories
  FOR DELETE TO authenticated
  USING (
    store_id IS NOT NULL AND public.is_store_admin(store_id)
  );

-- ------------------------------------------------------------------------------
-- 6. Product Children RLS Policies (Images, Features, Tags)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Public reads images" ON public.product_images;
DROP POLICY IF EXISTS "Admins write images" ON public.product_images;

CREATE POLICY "Public and members read product images" ON public.product_images
  FOR SELECT TO anon, authenticated
  USING (
    public.product_is_live(product_id)
    OR public.is_store_member(public.product_store_id(product_id))
  );

CREATE POLICY "Store editors insert product images" ON public.product_images
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_store_editor(public.product_store_id(product_id))
  );

CREATE POLICY "Store editors update product images" ON public.product_images
  FOR UPDATE TO authenticated
  USING (
    public.is_store_editor(public.product_store_id(product_id))
  )
  WITH CHECK (
    public.is_store_editor(public.product_store_id(product_id))
  );

CREATE POLICY "Store editors delete product images" ON public.product_images
  FOR DELETE TO authenticated
  USING (
    public.is_store_editor(public.product_store_id(product_id))
  );

-- Product Features
DROP POLICY IF EXISTS "Public reads features" ON public.product_features;
DROP POLICY IF EXISTS "Admins write features" ON public.product_features;

CREATE POLICY "Public and members read product features" ON public.product_features
  FOR SELECT TO anon, authenticated
  USING (
    public.product_is_live(product_id)
    OR public.is_store_member(public.product_store_id(product_id))
  );

CREATE POLICY "Store editors insert product features" ON public.product_features
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_store_editor(public.product_store_id(product_id))
  );

CREATE POLICY "Store editors update product features" ON public.product_features
  FOR UPDATE TO authenticated
  USING (
    public.is_store_editor(public.product_store_id(product_id))
  )
  WITH CHECK (
    public.is_store_editor(public.product_store_id(product_id))
  );

CREATE POLICY "Store editors delete product features" ON public.product_features
  FOR DELETE TO authenticated
  USING (
    public.is_store_editor(public.product_store_id(product_id))
  );

-- Product Tags
DROP POLICY IF EXISTS "Public reads tags" ON public.product_tags;
DROP POLICY IF EXISTS "Admins write tags" ON public.product_tags;

CREATE POLICY "Public and members read product tags" ON public.product_tags
  FOR SELECT TO anon, authenticated
  USING (
    public.product_is_live(product_id)
    OR public.is_store_member(public.product_store_id(product_id))
  );

CREATE POLICY "Store editors insert product tags" ON public.product_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_store_editor(public.product_store_id(product_id))
  );

CREATE POLICY "Store editors update product tags" ON public.product_tags
  FOR UPDATE TO authenticated
  USING (
    public.is_store_editor(public.product_store_id(product_id))
  )
  WITH CHECK (
    public.is_store_editor(public.product_store_id(product_id))
  );

CREATE POLICY "Store editors delete product tags" ON public.product_tags
  FOR DELETE TO authenticated
  USING (
    public.is_store_editor(public.product_store_id(product_id))
  );

-- ------------------------------------------------------------------------------
-- 7. Outbound Clicks RLS Policies
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone logs clicks on live products" ON public.outbound_clicks;
DROP POLICY IF EXISTS "Admins read clicks" ON public.outbound_clicks;

CREATE POLICY "Anyone logs clicks on live products" ON public.outbound_clicks
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    public.product_is_live(product_id)
    AND (store_id IS NULL OR store_id = public.product_store_id(product_id))
  );

CREATE POLICY "Store admins read own clicks" ON public.outbound_clicks
  FOR SELECT TO authenticated
  USING (
    store_id IS NOT NULL AND public.is_store_admin(store_id)
  );

CREATE POLICY "Store owners delete own clicks" ON public.outbound_clicks
  FOR DELETE TO authenticated
  USING (
    store_id IS NOT NULL AND (public.is_store_owner(store_id) OR public.is_super_admin())
  );

-- ------------------------------------------------------------------------------
-- 8. Hardened Store Members RLS (Owner Protection)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Store admins insert store members" ON public.store_members;
CREATE POLICY "Store admins insert store members" ON public.store_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_store_admin(store_id)
    AND (role != 'owner' OR public.is_store_owner(store_id))
  );

DROP POLICY IF EXISTS "Store admins update store members" ON public.store_members;
CREATE POLICY "Store admins update store members" ON public.store_members
  FOR UPDATE TO authenticated
  USING (
    public.is_store_admin(store_id)
    AND (role != 'owner' OR public.is_store_owner(store_id))
  )
  WITH CHECK (
    public.is_store_admin(store_id)
    AND (role != 'owner' OR public.is_store_owner(store_id))
  );

-- ------------------------------------------------------------------------------
-- 9. Storage Object Scoping (Tenant Folder Partitioning)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins read store images" ON storage.objects;
DROP POLICY IF EXISTS "Admins upload store images" ON storage.objects;
DROP POLICY IF EXISTS "Admins update store images" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete store images" ON storage.objects;

-- Public can view stored images
CREATE POLICY "Public reads store images" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'store-images');

-- Store editors can upload images to their store's partition folder
CREATE POLICY "Store editors upload store images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'store-images'
    AND (
      public.is_super_admin()
      OR (
        (storage.foldername(name))[1] IS NOT NULL
        AND public.is_store_editor(((storage.foldername(name))[1])::uuid)
      )
      OR (
        (storage.foldername(name))[1] IS NULL
        AND public.is_store_editor('00000000-0000-0000-0000-000000000001'::uuid)
      )
    )
  );

-- Store editors can update images in their store's folder
CREATE POLICY "Store editors update store images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'store-images'
    AND (
      public.is_super_admin()
      OR (
        (storage.foldername(name))[1] IS NOT NULL
        AND public.is_store_editor(((storage.foldername(name))[1])::uuid)
      )
      OR (
        (storage.foldername(name))[1] IS NULL
        AND public.is_store_editor('00000000-0000-0000-0000-000000000001'::uuid)
      )
    )
  );

-- Store admins can delete images in their store's folder
CREATE POLICY "Store admins delete store images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'store-images'
    AND (
      public.is_super_admin()
      OR (
        (storage.foldername(name))[1] IS NOT NULL
        AND public.is_store_admin(((storage.foldername(name))[1])::uuid)
      )
      OR (
        (storage.foldername(name))[1] IS NULL
        AND public.is_store_admin('00000000-0000-0000-0000-000000000001'::uuid)
      )
    )
  );
