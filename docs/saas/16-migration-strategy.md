# 16 — Zero-Downtime Safe Database Migration Strategy

## 1. Migration Protocol & Philosophy

To guarantee that the live Our Visible Universe Store is never interrupted, corrupted, or degraded, all architectural changes follow a **10-Stage Additive Migration Protocol**.

No columns or tables are deleted or renamed destructively during initial deployment. Existing columns remain readable, and historical records are preserved through careful backfilling.

---

## 2. The 10-Stage Migration Plan

```
┌────────────────────────────────────────────────────────────────────────┐
│                   10-STAGE SAFE MIGRATION PROTOCOL                     │
├────────────────────────────────────────────────────────────────────────┤
│ Stage 1: Dedicated Development Database Isolation                      │
│ Stage 2: Verified Production Backup & Snapshot                         │
│ Stage 3: Additive Schema Creation (`stores`, `store_members`, etc.)    │
│ Stage 4: Tenant 0 Genesis ("Our Visible Universe" Provisioning)        │
│ Stage 5: Foreign Key Backfilling (`store_id` attachment)               │
│ Stage 6: Constraint Evolution (Global -> Compound Uniqueness)          │
│ Stage 7: Dual-Read & Compatibility Middleware                          │
│ Stage 8: Row Level Security (RLS) Policy Modernization                 │
│ Stage 9: Verification Queries & Integrity Testing                      │
│ Stage 10: Production Cutover & Acceptance Verification                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Detailed Stage Breakdown

#### Stage 1: Development Database Isolation

- **Rule**: Never run DDL migrations directly on production.
- **Action**: Provision an isolated staging/development Supabase instance. Configure local `.env` with staging credentials (`VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

#### Stage 2: Verified Production Backup & Snapshot

- **Action**: Perform a full PostgreSQL physical dump (`pg_dump -Fc`) and snapshot the private `store-images` storage bucket before running any migration scripts.
- **Verification**: Test restore of the snapshot into a local Docker container to verify dump integrity.

#### Stage 3: Additive Schema Creation

- **Action**: Execute Migration `0010_multi_tenant_foundation.sql`:
  - Create `public.stores`
  - Create `public.store_members`
  - Create `public.store_invitations`
  - Create `public.store_domains`
  - Create `public.store_designs`
  - Create `public.store_design_versions`
  - Create `public.store_settings`
  - Create `public.collections`
- **Safety**: None of these tables conflict with existing single-tenant tables.

#### Stage 4: Tenant 0 Genesis (Our Visible Universe Provisioning)

- **Action**: Insert the flagship tenant record:
  ```sql
  INSERT INTO public.stores (id, name, slug, status, plan_tier, created_by)
  VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Our Visible Universe',
    'ourvisibleuniverse',
    'active',
    'enterprise',
    (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1)
  );
  ```
- **Store Settings Backfill**:
  Migrate existing data from `public.site_settings WHERE id = 1` into `public.store_settings (store_id = '00000000-0000-0000-0000-000000000001')`.

#### Stage 5: Foreign Key Backfilling (`store_id`)

- **Action**:
  1. Add nullable `store_id` column to existing operational tables:
     ```sql
     ALTER TABLE public.products ADD COLUMN store_id uuid REFERENCES public.stores(id);
     ALTER TABLE public.categories ADD COLUMN store_id uuid REFERENCES public.stores(id);
     ALTER TABLE public.outbound_clicks ADD COLUMN store_id uuid REFERENCES public.stores(id);
     ```
  2. Backfill all existing records to Tenant 0:
     ```sql
     UPDATE public.products SET store_id = '00000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
     UPDATE public.categories SET store_id = '00000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
     UPDATE public.outbound_clicks SET store_id = '00000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
     ```
  3. Apply `NOT NULL` constraint:
     ```sql
     ALTER TABLE public.products ALTER COLUMN store_id SET NOT NULL;
     ALTER TABLE public.categories ALTER COLUMN store_id SET NOT NULL;
     ALTER TABLE public.outbound_clicks ALTER COLUMN store_id SET NOT NULL;
     ```

#### Stage 6: Constraint Evolution (Global -> Compound Uniqueness)

- **Action**:
  1. Drop global unique constraint on slugs:
     ```sql
     ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_slug_key;
     ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_slug_key;
     ```
  2. Create store-scoped compound unique constraints:
     ```sql
     ALTER TABLE public.products ADD CONSTRAINT products_store_slug_unique UNIQUE(store_id, slug);
     ALTER TABLE public.categories ADD CONSTRAINT categories_store_slug_unique UNIQUE(store_id, slug);
     ```
  3. Replace global duplicate affiliate trigger with tenant-scoped version (`prevent_duplicate_affiliate_publishing`).

#### Stage 7: Dual-Read & Compatibility Middleware

- **Action**: Ensure application query functions (`src/lib/store.ts`) support fallback to Tenant 0 when no `tenant_id` is supplied in context. This ensures that legacy routes or bookmarks continue working without disruption.

#### Stage 8: Row Level Security (RLS) Policy Modernization

- **Action**: Drop old global `is_admin()` policies and apply tenant-scoped policies (`is_store_member(store_id)`, `is_store_admin(store_id)`).

#### Stage 9: Verification Queries & Integrity Testing

- Run automated verification queries:
  - `SELECT count(*) FROM public.products WHERE store_id IS NULL;` (Must return 0).
  - Verify Tenant 0 products render on the storefront.
  - Verify admin login can inspect and edit products.
  - Execute full Vitest suite (`npm test`) to ensure all 48 existing tests pass.

#### Stage 10: Production Cutover

- Execute the migration on production credentials during a scheduled maintenance window.
- Verify HTTP 200 responses on all public and admin endpoints.
- Monitor error capture logs (`src/lib/error-capture.ts`).

---

## 3. Rollback Plan

If unexpected failures occur during cutover:

1. Re-run `ALTER TABLE products ALTER COLUMN store_id DROP NOT NULL;`.
2. Restore global unique constraints `UNIQUE(slug)` if multi-tenant records have not yet been inserted.
3. Re-apply Migration `0000`–`0009` RLS policies.
4. If schema is corrupted, restore the Stage 2 snapshot in under 3 minutes.
