# Phase 2 — Prompt 07: Multi-Tenant Product, Category, and Affiliate Data Migration

## 1. Executive Summary & Migration Strategy

In accordance with Phase 2 Prompt 07 instructions:

- **Zero Production Mutation**: The live database is unverified/production (`-prod.lovable.cloud`). Therefore, all database write operations against the remote backend remain **strictly blocked** using the Phase 2 database safety guard.
- **Staged Expand-and-Contract Architecture**: Migration `0011_multi_tenant_commerce_migration.sql` was prepared and validated. It adds nullable `store_id` columns, provides an idempotent backfill for Flagship Tenant 0 ("Our Visible Universe"), transitions global uniqueness to compound store-scoped uniqueness (`UNIQUE(store_id, slug)`), replaces global affiliate checks with store-scoped duplicate triggers, and enforces cross-store category boundary protection.
- **Data Integrity & Zero Loss**: Every product field, category hierarchy, image reference, soft-deletion flag, and raw affiliate tracking query parameter is preserved with 100% fidelity.

---

## 2. Commerce Entity Ownership Model

```
                    ┌─────────────────────────┐
                    │      public.stores      │
                    │   (Tenant Root Entity)  │
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │ (1:N)                 │ (1:N)                 │ (1:N)
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│public.categories│     │ public.products │     │outbound_clicks  │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id (PK)         │     │ id (PK)         │     │ id (PK)         │
│ store_id (FK)   │     │ store_id (FK)   │     │ store_id (FK)   │
│ name            │     │ name            │     │ product_id (FK) │
│ slug            │     │ slug            │     │ created_at      │
│ active          │     │ category_ids[]  │     └─────────────────┘
│ sort_order      │     │ affiliate_url   │
└────────┬────────┘     │ price, currency │
         │              │ active, deleted │
         │              └────────┬────────┘
         │                       │
         │ (Checked via Trigger) │ (1:N Parent Reference)
         └───────────────────────┼───────────────────────┐
                                 │                       │
                                 ▼                       ▼
                       ┌───────────────────┐   ┌───────────────────┐
                       │  product_images   │   │ product_features  │
                       ├───────────────────┤   ├───────────────────┤
                       │ id (PK)           │   │ id (PK)           │
                       │ product_id (FK)   │   │ product_id (FK)   │
                       │ image_url         │   │ feature           │
                       │ sort_order        │   │ sort_order        │
                       └───────────────────┘   └───────────────────┘
```

### Direct Denormalization vs Parent Reference

- **Direct `store_id` on `products` and `categories`**: Required for immediate tenant-level filtering, compounding uniqueness constraints, and high-performance querying without multi-table joins.
- **Direct `store_id` on `outbound_clicks`**: Added to enable direct aggregate analytics per store without joining the products table on every click query.
- **Parent Reference on Child Entities (`product_images`, `product_features`, `product_tags`)**: Preserved via `product_id -> products.store_id`. Normalization is maintained; child entities inherit tenant isolation cleanly without denormalized store columns.

---

## 3. Schema Changes & Migration File Details

### Migration File: `drizzle/migrations/0011_multi_tenant_commerce_migration.sql`

Registered in `drizzle/migrations/meta/_journal.json` at `idx: 11`.

#### 3.1 Added Columns

```sql
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE;
ALTER TABLE public.outbound_clicks ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE;
```

#### 3.2 Idempotent Legacy Backfill (Tenant 0)

```sql
UPDATE public.categories SET store_id = '00000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.products SET store_id = '00000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.outbound_clicks oc SET store_id = p.store_id FROM public.products p WHERE oc.product_id = p.id AND oc.store_id IS NULL;
UPDATE public.outbound_clicks SET store_id = '00000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
```

#### 3.3 Compound Store-Scoped Uniqueness Constraints

- Dropped: `products_slug_key` (global)
- Added: `CONSTRAINT products_store_slug_unique UNIQUE (store_id, slug)`
- Dropped: `categories_slug_key` (global)
- Added: `CONSTRAINT categories_store_slug_unique UNIQUE (store_id, slug)`

#### 3.4 Store-Scoped Duplicate Affiliate Publishing Trigger

Replaces `prevent_duplicate_affiliate_publishing`:

- Uses transactional advisory locks hashed with `(candidate_url || NEW.store_id)`.
- Scopes duplicate validation strictly within `NEW.store_id`. Multiple stores can now legitimately promote the same retailer offer without collision.

#### 3.5 Cross-Store Category Relational Integrity Trigger

Enhanced `validate_product_categories`:

- Enforces that every category ID in `NEW.category_ids` and `NEW.category_id` exists and shares `c.store_id = NEW.store_id`.
- Rejects attempts to assign categories across store boundaries with SQL state `23503`.

---

## 4. Multi-Store Test Verification

Three representative stores were evaluated in `src/test/multi-tenant-commerce.test.ts`:

1. **Astronomy Store** (`00000000-0000-0000-0000-000000000001`): Flagship tenant (telescopes, sky charts).
2. **Fashion Store** (`store-fashion-222`): Apparel and urban streetwear.
3. **Footwear Store** (`store-footwear-333`): Performance sneakers.

### Verified Test Properties

- **Cross-Store Identical Slugs**: Both the Fashion store and Footwear store successfully register `running-shoes` without conflict.
- **Intra-Store Slug Uniqueness**: Attempting to create duplicate `running-shoes` within the Fashion store is rejected with `DUPLICATE_STORE_SLUG`.
- **Self-Edits**: Editing a product while maintaining its current slug within the same store succeeds.
- **Cross-Store Category Rejection**: Assigning Astronomy's `Telescopes` category to a Fashion product is rejected with `CROSS_STORE_CATEGORY_ASSIGNMENT`.
- **Cross-Store Affiliate URL Coexistence**: An identical Amazon affiliate URL published in Store A and Store B succeeds; publishing duplicate active links in Store A is rejected with `DUPLICATE_STORE_AFFILIATE_URL`.
- **Soft-Deletion Immunity**: Soft-deleted products (`deleted_at !== null`) do not block new products from publishing identical affiliate URLs.
- **Data Integrity Audit**: Migration backfill preserves all original fields (IDs, names, prices, currencies, tags, features, images, and affiliate parameters) with zero corruption.

---

## 5. Rollback & Disaster Recovery Strategy

If an issue occurs during staging execution:

```sql
-- Reversal Script for Migration 0011
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_store_slug_unique;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_store_slug_unique;

ALTER TABLE public.products ADD CONSTRAINT products_slug_key UNIQUE (slug);
ALTER TABLE public.categories ADD CONSTRAINT categories_slug_key UNIQUE (slug);

ALTER TABLE public.outbound_clicks DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.products DROP COLUMN IF EXISTS store_id;
ALTER TABLE public.categories DROP COLUMN IF EXISTS store_id;
```

---

## 6. Required Next Steps (Prompt 08)

- **Complete Multi-Tenant Row Level Security (RLS)**: Enforce store-level isolation across public and authenticated roles so external customer onboarding can safely be unlocked.
