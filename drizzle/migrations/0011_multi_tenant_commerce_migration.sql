-- ==============================================================================
-- Migration 0011: Multi-Tenant Product, Category, and Affiliate Migration
-- ==============================================================================
-- Description:
--  1. Adds store_id to categories, products, and outbound_clicks.
--  2. Safely backfills existing records to Tenant 0 ('00000000-0000-0000-0000-000000000001').
--  3. Replaces global uniqueness with compound store-scoped uniqueness:
--     - UNIQUE(store_id, slug) on public.products
--     - UNIQUE(store_id, slug) on public.categories
--  4. Replaces global duplicate affiliate trigger with store-scoped trigger.
--  5. Updates validate_product_categories trigger to strictly forbid cross-store category references.
--  6. Adds tenant-isolated composite query indexes.
-- ==============================================================================

-- 1. Add store_id columns (nullable during expand phase, populated by backfill)
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.outbound_clicks
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE;

-- 2. Idempotent Backfill to Flagship Tenant 0 ('Our Visible Universe')
UPDATE public.categories
SET store_id = '00000000-0000-0000-0000-000000000001'
WHERE store_id IS NULL;

UPDATE public.products
SET store_id = '00000000-0000-0000-0000-000000000001'
WHERE store_id IS NULL;

UPDATE public.outbound_clicks oc
SET store_id = p.store_id
FROM public.products p
WHERE oc.product_id = p.id AND oc.store_id IS NULL;

UPDATE public.outbound_clicks
SET store_id = '00000000-0000-0000-0000-000000000001'
WHERE store_id IS NULL;

-- 3. Transition from Global Uniqueness to Store-Scoped Uniqueness
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_slug_key;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_store_slug_unique;
ALTER TABLE public.products ADD CONSTRAINT products_store_slug_unique UNIQUE (store_id, slug);

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_slug_key;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_store_slug_unique;
ALTER TABLE public.categories ADD CONSTRAINT categories_store_slug_unique UNIQUE (store_id, slug);

-- 4. Store-Scoped Affiliate URL Duplicate Trigger
CREATE OR REPLACE FUNCTION public.prevent_duplicate_affiliate_publishing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate_url text;
BEGIN
  candidate_url := COALESCE(NULLIF(btrim(NEW.affiliate_url), ''), NULLIF(btrim(NEW.amazon_url), ''));
  IF candidate_url IS NULL THEN
    RETURN NEW;
  END IF;

  -- Advisory lock scoped per store and candidate URL to prevent race conditions
  PERFORM pg_advisory_xact_lock(hashtextextended(candidate_url || COALESCE(NEW.store_id::text, ''), 0));

  -- Check duplicate affiliate URLs strictly within the same store
  IF NEW.active AND NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.store_id = NEW.store_id
      AND p.id IS DISTINCT FROM NEW.id
      AND COALESCE(NULLIF(btrim(p.affiliate_url), ''), NULLIF(btrim(p.amazon_url), '')) = candidate_url
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'This affiliate URL is already used by another product in this store. Use a different URL before publishing.',
      CONSTRAINT = 'products_store_duplicate_affiliate_url';
  END IF;
  RETURN NEW;
END
$$;

DROP INDEX IF EXISTS products_effective_affiliate_url_lookup;
CREATE INDEX products_store_effective_affiliate_lookup
ON public.products (store_id, (COALESCE(NULLIF(btrim(affiliate_url), ''), NULLIF(btrim(amazon_url), ''))));

-- 5. Cross-Store Category Validation Trigger
-- Enforces that product categories strictly belong to the same store as the product
CREATE OR REPLACE FUNCTION public.validate_product_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Sync category_ids array if primary category_id is set alone
  IF TG_OP = 'INSERT' THEN
    IF cardinality(NEW.category_ids) = 0 AND NEW.category_id IS NOT NULL THEN
      NEW.category_ids := ARRAY[NEW.category_id];
    END IF;
  ELSIF NEW.category_id IS DISTINCT FROM OLD.category_id AND NEW.category_ids IS NOT DISTINCT FROM OLD.category_ids THEN
    NEW.category_ids := array_remove(NEW.category_ids, OLD.category_id);
    IF NEW.category_id IS NOT NULL THEN
      NEW.category_ids := ARRAY[NEW.category_id] || array_remove(NEW.category_ids, NEW.category_id);
    END IF;
  END IF;

  -- 2. Verify all categories exist and belong strictly to NEW.store_id (if store_id is present)
  IF NEW.store_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.category_ids) AS selected(id)
      WHERE id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.categories c
        WHERE c.id = selected.id AND (c.store_id IS NULL OR c.store_id = NEW.store_id)
      )
    ) THEN
      RAISE EXCEPTION 'Please select valid categories belonging to this store.' USING ERRCODE = '23503';
    END IF;

    IF NEW.category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.categories c
      WHERE c.id = NEW.category_id AND (c.store_id IS NULL OR c.store_id = NEW.store_id)
    ) THEN
      RAISE EXCEPTION 'Primary category must belong to the same store as the product.' USING ERRCODE = '23503';
    END IF;
  ELSE
    -- Legacy validation fallback if store_id is not yet set
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.category_ids) AS selected(id)
      WHERE id IS NULL OR NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = selected.id)
    ) THEN
      RAISE EXCEPTION 'Please select valid product categories.' USING ERRCODE = '23503';
    END IF;
  END IF;

  -- 3. Reject duplicate category assignments
  IF cardinality(NEW.category_ids) <> (SELECT count(DISTINCT id) FROM unnest(NEW.category_ids) AS selected(id)) THEN
    RAISE EXCEPTION 'Product categories must not contain duplicates.' USING ERRCODE = '23514';
  END IF;

  -- 4. Ensure category_id mirrors the first category in array
  NEW.category_id := NEW.category_ids[1];
  RETURN NEW;
END;
$$;

-- 6. Performance Indexes for Store Scoping
CREATE INDEX IF NOT EXISTS products_store_public_idx
  ON public.products (store_id, active, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS products_store_category_idx
  ON public.products (store_id, category_id);

CREATE INDEX IF NOT EXISTS categories_store_active_idx
  ON public.categories (store_id, active, sort_order);

CREATE INDEX IF NOT EXISTS outbound_clicks_store_idx
  ON public.outbound_clicks (store_id, created_at DESC);
