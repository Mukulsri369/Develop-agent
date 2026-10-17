# 07 — Database Architecture & Authentication Audit

## 1. Relational Entity & Schema Mapping

The database schema is defined in 10 sequential PostgreSQL migrations in `drizzle/migrations/`. Below is the complete structural audit of every table, view, function, and trigger in the current application.

---

### Entity Detailed Specifications

#### 1. `public.admins`

- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**: `email text NOT NULL UNIQUE`, `created_at timestamptz NOT NULL DEFAULT now()`
- **Foreign Keys**: None. Matches `auth.users.email` by lower-case comparison in `is_admin()`.
- **Unique Constraints**: `email UNIQUE`
- **Indexes**: Implicit unique index on `email`.
- **Row Level Security (RLS)**:
  - `SELECT`: Restricted to authenticated admins via `USING (public.is_admin())`.
  - `INSERT` / `DELETE`: Restricted to authenticated admins (`WITH CHECK (public.is_admin())` and `USING (public.is_admin())`).
- **Store Identifier**: **NONE**. Global platform administrator table.
- **Single-Tenant Assumption**: Assumes all admins have god-mode administrative power across the entire database.

#### 2. `public.site_settings` & `public.public_site_settings`

- **Primary Key**: `id int PRIMARY KEY DEFAULT 1 CHECK (id = 1)`
- **Columns**: `store_name text`, `logo_url text`, `instagram_url text`, `contact_email text`, `affiliate_disclosure text`, `footer_text text`, `social_links jsonb`, `updated_at timestamptz`
- **Foreign Keys**: None.
- **Unique Constraints**: Constrained to single row `CHECK (id = 1)`.
- **Row Level Security (RLS)**:
  - Direct `site_settings`: Anon select revoked; authenticated admins read and update.
  - Public View `public_site_settings`: Security invoker view exposing `id, store_name, logo_url, instagram_url, affiliate_disclosure, footer_text, social_links, updated_at` (omits sensitive `contact_email`).
- **Store Identifier**: **NONE** (singleton record `id = 1`).
- **Single-Tenant Assumption**: **CRITICAL SINGLETON**. Can only support one store at a time in its current form.

#### 3. `public.categories`

- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**: `name text NOT NULL`, `slug text NOT NULL UNIQUE`, `description text`, `image_url text`, `active boolean DEFAULT true`, `sort_order int DEFAULT 0`, `created_at`, `updated_at`
- **Foreign Keys**: None.
- **Unique Constraints**: `slug text NOT NULL UNIQUE` (Global slug uniqueness across entire database!).
- **Row Level Security (RLS)**:
  - `SELECT`: Public for `active = true OR public.is_admin()`.
  - `INSERT` / `UPDATE` / `DELETE`: Authenticated admin only (`WITH CHECK (public.is_admin())`).
- **Store Identifier**: **NONE**.
- **Single-Tenant Assumption**: All stores would share the same category taxonomy or collide on category slugs (e.g. two stores having `/category/electronics`).

#### 4. `public.products`

- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**: `name text NOT NULL`, `slug text NOT NULL UNIQUE`, `short_description text`, `description text`, `brand text`, `subcategory text`, `category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL`, `category_ids uuid[] DEFAULT '{}'`, `affiliate_url text`, `retailer text`, `retailer_product_id text`, `amazon_url text`, `amazon_asin text`, `amazon_marketplace text`, `price numeric(12,2)`, `currency text DEFAULT 'INR'`, `price_updated_at timestamptz`, `featured boolean DEFAULT false`, `active boolean DEFAULT false`, `deleted_at timestamptz`, `created_at`, `updated_at`
- **Foreign Keys**: `category_id` references `public.categories(id)`.
- **Unique Constraints**: `slug text NOT NULL UNIQUE` (Global product slug uniqueness!).
- **Indexes**:
  - `products_public_idx ON (active, deleted_at, created_at DESC)`
  - `products_category_idx ON (category_id)`
  - `products_category_ids_idx ON (category_ids) USING GIN`
  - `products_effective_affiliate_url_lookup ON (COALESCE(NULLIF(btrim(affiliate_url), ''), NULLIF(btrim(amazon_url), '')))`
- **Row Level Security (RLS)**:
  - `SELECT`: Public for `(active AND deleted_at IS NULL) OR public.is_admin()`.
  - `INSERT` / `UPDATE` / `DELETE`: Authenticated admin only (`WITH CHECK (public.is_admin())`).
- **Store Identifier**: **NONE**.
- **Triggers**:
  - `products_updated`: Auto-updates `updated_at`.
  - `validate_product_categories`: Validates array foreign keys, uniqueness, and mirrors first element to `category_id`.
  - `prevent_duplicate_affiliate_publishing`: Checks global uniqueness of affiliate links across all products.
- **Single-Tenant Assumptions**:
  - Global `slug` uniqueness prevents different stores from having identically named products.
  - Trigger `prevent_duplicate_affiliate_publishing` blocks two different stores from recommending the same Amazon affiliate URL.

#### 5. `public.product_images`

- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**: `product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE`, `image_url text NOT NULL`, `storage_path text`, `alt_text text`, `sort_order int DEFAULT 0`, `created_at`
- **Foreign Keys**: `product_id REFERENCES public.products(id)`.
- **Indexes**: `product_images_pid ON (product_id, sort_order)`.
- **Row Level Security (RLS)**:
  - `SELECT`: Public for `product_is_live(product_id) OR public.is_admin()`.
  - `ALL`: Admin only (`WITH CHECK (public.is_admin())`).
- **Store Identifier**: Inherited via `product_id`.

#### 6. `public.product_features` & `public.product_tags`

- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**: `product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE`, `feature text` / `tag text`, `sort_order int` (features only).
- **Indexes**: `product_features_pid`, `product_tags_pid`, `product_tags_tag ON (lower(tag))`.
- **Row Level Security (RLS)**: Public reads for live products; admin writes.
- **Store Identifier**: Inherited via `product_id`.

#### 7. `public.outbound_clicks`

- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**: `product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE`, `created_at timestamptz DEFAULT now()`.
- **Indexes**: `outbound_clicks_pid ON (product_id)`.
- **Row Level Security (RLS)**: Anon/authenticated can insert if `product_is_live(product_id)`; authenticated admins can read.
- **Store Identifier**: Inherited via `product_id`.

---

## 2. Authentication & Authorization Flow

### Current Security Architecture

1. **Supabase Auth**: Users log in via email and password using standard Supabase GoTrue Auth (`supabase.auth.signInWithPassword`).
2. **Admin Verification Function (`is_admin()`)**:
   ```sql
   CREATE OR REPLACE FUNCTION public.is_admin()
   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
     SELECT EXISTS (
       SELECT 1 FROM public.admins a
       JOIN auth.users u ON lower(u.email) = lower(a.email)
       WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
     )
   $$;
   ```
3. **Admin Invitation Function (`is_approved_admin_email(text)`)**:
   Checks whether a given email exists in `public.admins` before signup or invitation.
4. **Storage Security Policies**:
   `storage.objects` policies restrict uploads, reads, updates, and deletes in the `store-images` bucket strictly to users satisfying `public.is_admin()`.

### Multi-Tenant Auth Redesign Requirements

- Replace the binary global admin check (`is_admin()`) with a tenant-scoped membership check:
  ```sql
  CREATE TABLE public.tenant_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, user_id)
  );
  ```
- Function `is_tenant_admin(check_tenant_id uuid)` checks if `auth.uid()` has an active admin or owner role in `check_tenant_id`.
- Tenant membership allows one user account to own multiple stores or be invited as an editor to someone else's storefront.

---

## 3. Storage Architecture & Tenant Isolation

- **Current Implementation**:
  - Single private Supabase bucket: `store-images`.
  - Paths organized as: `products/{uuid}.webp`, `categories/{uuid}.webp`, `branding/{uuid}.webp`.
  - Public visitors cannot read directly from the bucket; all assets are served through the proxy endpoint `/api/public/img/$` which uses the service-role admin client to fetch the file and stream it with caching headers.
- **Multi-Tenant Adaptation**:
  - Keep the private bucket pattern (it prevents hotlinking and protects storage keys).
  - Prefix all object paths with `tenant_id`: `{tenant_id}/products/{uuid}.webp`.
  - Update proxy endpoint to validate tenant access: `/api/public/img/:tenant_id/*`.
  - Update storage RLS policies to enforce `bucket_id = 'store-images' AND is_tenant_admin(split_part(name, '/', 1)::uuid)`.
