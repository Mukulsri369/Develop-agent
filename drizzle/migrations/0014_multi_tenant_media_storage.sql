-- ==============================================================================
-- Migration 0014: Multi-Tenant Media Storage, Asset Ownership and File Security
-- ==============================================================================
-- 1. Helper function extracting store_id from storage object path
-- 2. Metadata table public.store_assets tracking media ownership, types, and quotas
-- 3. Row-level security for store_assets and storage.objects
-- 4. Storage quota and usage view

-- 1. Safe storage store_id parser
CREATE OR REPLACE FUNCTION public.extract_storage_store_id(path text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_segments text[];
  v_first text;
  v_second text;
BEGIN
  IF path IS NULL OR length(trim(path)) = 0 THEN
    RETURN NULL;
  END IF;

  v_segments := string_to_array(trim(leading '/' from path), '/');

  IF array_length(v_segments, 1) < 1 THEN
    RETURN NULL;
  END IF;

  v_first := v_segments[1];

  -- Format: stores/{store_id}/{asset_type}/{asset_id}.{ext}
  IF v_first = 'stores' AND array_length(v_segments, 1) >= 2 THEN
    v_second := v_segments[2];
    IF v_second ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN v_second::uuid;
    END IF;
  END IF;

  -- Format: {store_id}/{asset_type}/{asset_id}.{ext}
  IF v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_first::uuid;
  END IF;

  -- Format: legacy single-tenant folders (products/..., categories/..., branding/...)
  -- These all belong to Tenant 0 ("Our Visible Universe")
  IF v_first IN ('products', 'categories', 'branding') THEN
    RETURN '00000000-0000-0000-0000-000000000001'::uuid;
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.extract_storage_store_id(text) TO anon, authenticated, service_role;

-- 2. Asset Metadata Table
CREATE TABLE IF NOT EXISTS public.store_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  bucket_id text NOT NULL DEFAULT 'store-images',
  storage_path text NOT NULL UNIQUE,
  asset_type text NOT NULL CHECK (asset_type IN ('products', 'categories', 'branding', 'generated', 'documents')),
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL DEFAULT 0,
  width int,
  height int,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'unlisted')),
  checksum_sha256 text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_ai_generated boolean NOT NULL DEFAULT false,
  ai_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  usage_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_assets_store_idx ON public.store_assets(store_id);
CREATE INDEX IF NOT EXISTS store_assets_path_idx ON public.store_assets(storage_path);
CREATE INDEX IF NOT EXISTS store_assets_type_idx ON public.store_assets(asset_type);
CREATE INDEX IF NOT EXISTS store_assets_vis_idx ON public.store_assets(visibility);
CREATE INDEX IF NOT EXISTS store_assets_deleted_idx ON public.store_assets(deleted_at);

-- 3. Trigger preventing store_id mutation
DROP TRIGGER IF EXISTS trg_prevent_asset_store_mutation ON public.store_assets;
CREATE TRIGGER trg_prevent_asset_store_mutation
  BEFORE UPDATE ON public.store_assets
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_mutation();

-- 4. Trigger updated_at
DROP TRIGGER IF EXISTS store_assets_updated ON public.store_assets;
CREATE TRIGGER store_assets_updated
  BEFORE UPDATE ON public.store_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. RLS for store_assets metadata
ALTER TABLE public.store_assets ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.store_assets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_assets TO authenticated;
GRANT ALL ON public.store_assets TO service_role;

DROP POLICY IF EXISTS "Public reads active store assets" ON public.store_assets;
CREATE POLICY "Public reads active store assets" ON public.store_assets
  FOR SELECT TO anon, authenticated
  USING (
    visibility = 'public'
    AND deleted_at IS NULL
    AND public.store_is_active(store_id)
  );

DROP POLICY IF EXISTS "Store members read own assets" ON public.store_assets;
CREATE POLICY "Store members read own assets" ON public.store_assets
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_store_member(store_id)
  );

DROP POLICY IF EXISTS "Store editors insert assets" ON public.store_assets;
CREATE POLICY "Store editors insert assets" ON public.store_assets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.is_store_editor(store_id)
  );

DROP POLICY IF EXISTS "Store admins update assets" ON public.store_assets;
CREATE POLICY "Store admins update assets" ON public.store_assets
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_store_admin(store_id)
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_store_admin(store_id)
  );

DROP POLICY IF EXISTS "Store admins delete assets" ON public.store_assets;
CREATE POLICY "Store admins delete assets" ON public.store_assets
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_store_admin(store_id)
  );

-- 6. Updated Storage Policies on storage.objects
DROP POLICY IF EXISTS "Public reads store images" ON storage.objects;
CREATE POLICY "Public reads store images" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'store-images'
    AND (
      public.is_super_admin()
      OR (
        public.extract_storage_store_id(name) IS NOT NULL
        AND public.store_is_active(public.extract_storage_store_id(name))
        AND name NOT LIKE '%/documents/%'
        AND name NOT LIKE 'documents/%'
      )
      OR (
        public.extract_storage_store_id(name) IS NOT NULL
        AND public.is_store_member(public.extract_storage_store_id(name))
      )
    )
  );

DROP POLICY IF EXISTS "Store editors upload store images" ON storage.objects;
CREATE POLICY "Store editors upload store images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'store-images'
    AND (
      public.is_super_admin()
      OR (
        public.extract_storage_store_id(name) IS NOT NULL
        AND public.is_store_editor(public.extract_storage_store_id(name))
      )
    )
  );

DROP POLICY IF EXISTS "Store editors update store images" ON storage.objects;
CREATE POLICY "Store editors update store images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'store-images'
    AND (
      public.is_super_admin()
      OR (
        public.extract_storage_store_id(name) IS NOT NULL
        AND public.is_store_editor(public.extract_storage_store_id(name))
      )
    )
  );

DROP POLICY IF EXISTS "Store admins delete store images" ON storage.objects;
CREATE POLICY "Store admins delete store images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'store-images'
    AND (
      public.is_super_admin()
      OR (
        public.extract_storage_store_id(name) IS NOT NULL
        AND public.is_store_admin(public.extract_storage_store_id(name))
      )
    )
  );

-- 7. Storage Quota and Usage Aggregation View
CREATE OR REPLACE VIEW public.store_storage_usage
WITH (security_invoker = true)
AS
SELECT
  s.id AS store_id,
  s.name AS store_name,
  s.plan_tier,
  COUNT(a.id) FILTER (WHERE a.deleted_at IS NULL) AS total_assets,
  COALESCE(SUM(a.file_size_bytes) FILTER (WHERE a.deleted_at IS NULL), 0) AS total_bytes_used,
  COUNT(a.id) FILTER (WHERE a.asset_type = 'products' AND a.deleted_at IS NULL) AS product_assets,
  COUNT(a.id) FILTER (WHERE a.asset_type = 'branding' AND a.deleted_at IS NULL) AS branding_assets,
  COUNT(a.id) FILTER (WHERE a.is_ai_generated = true AND a.deleted_at IS NULL) AS generated_assets
FROM public.stores s
LEFT JOIN public.store_assets a ON a.store_id = s.id
GROUP BY s.id, s.name, s.plan_tier;

GRANT SELECT ON public.store_storage_usage TO authenticated;
