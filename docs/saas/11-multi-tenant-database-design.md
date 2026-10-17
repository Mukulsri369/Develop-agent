# 11 — Multi-Tenant Database Design & Schema Specification

## 1. Relational Architecture Overview

The multi-tenant schema organizes all operational data under a top-level **`stores`** tenant entity. All user authentication relies directly on Supabase Auth (`auth.users`), avoiding duplicated credentials or user records.

---

## 2. Table Specifications

### 2.1 Tenant & Access Hierarchy

#### `public.stores` (Tenants)

- **Purpose**: Defines an independent storefront tenant on the platform.
- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `name text NOT NULL`: Human-readable store name (e.g., "Aura Streetwear", "Our Visible Universe").
  - `slug text NOT NULL UNIQUE`: Subdomain handle (e.g., `aura` -> `aura.platform.com`).
  - `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived', 'draft'))`
  - `plan_tier text NOT NULL DEFAULT 'starter' CHECK (plan_tier IN ('starter', 'pro', 'enterprise'))`
  - `created_by uuid NOT NULL REFERENCES auth.users(id)`: Creator user account.
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
- **Indexes**: `CREATE INDEX stores_slug_idx ON public.stores(slug);`
- **RLS**:
  - `SELECT`: Public can read `active` stores; authenticated members can read their own stores.
  - `INSERT`: Any authenticated user can create a store (subject to subscription tier limits).
  - `UPDATE` / `DELETE`: Store `owner` only.
- **Deletion Behavior**: `CASCADE` to member records, products, categories, and designs.

#### `public.store_members`

- **Purpose**: Maps user accounts to stores with granular role-based permissions.
- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`
  - `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
  - `role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor'))`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **Constraints**: `UNIQUE(store_id, user_id)`
- **Indexes**: `CREATE INDEX store_members_lookup ON public.store_members(user_id, store_id);`
- **RLS**:
  - `SELECT`: Members of the same store.
  - `INSERT` / `UPDATE` / `DELETE`: Store `owner` and platform super admin.

#### `public.store_invitations`

- **Purpose**: Pending invitations to invite collaborators into a store team.
- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`
  - `email text NOT NULL`
  - `role text NOT NULL CHECK (role IN ('admin', 'editor'))`
  - `token text NOT NULL UNIQUE`
  - `expires_at timestamptz NOT NULL`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **RLS**: Store owners/admins can create and view invitations.

#### `public.store_domains`

- **Purpose**: Custom domain records and SSL verification tracking.
- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`
  - `domain text NOT NULL UNIQUE`: Full domain (e.g., `shop.brand.com`).
  - `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed'))`
  - `verification_txt text NOT NULL`: DNS TXT verification token.
  - `is_primary boolean NOT NULL DEFAULT false`
  - `verified_at timestamptz`
- **Indexes**: `CREATE INDEX store_domains_lookup ON public.store_domains(domain);`
- **RLS**: Public read for domain router lookup; store owner write.

---

### 2.2 Design & AI Generation

#### `public.store_designs`

- **Purpose**: Holds the current draft and active published design specification for a store.
- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `store_id uuid NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE`
  - `published_version_id uuid REFERENCES public.store_design_versions(id) ON DELETE SET NULL`
  - `draft_spec jsonb NOT NULL`: Complete draft design specification matching the Universal Storefront Spec.
  - `updated_at timestamptz NOT NULL DEFAULT now()`
- **RLS**:
  - `SELECT`: Public can view published design; store members can view draft design.
  - `UPDATE`: Store owner/admin/editor.

#### `public.store_design_versions`

- **Purpose**: Immutable history of all published and checkpointed designs.
- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`
  - `version int NOT NULL`
  - `name text NOT NULL`: e.g. "AI Initial Generation", "Holiday Redesign".
  - `spec jsonb NOT NULL`: Immutable snapshot of design specification.
  - `created_by uuid REFERENCES auth.users(id)`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **Constraints**: `UNIQUE(store_id, version)`
- **RLS**: Store members can read and create versions.

#### `public.design_generation_jobs`

- **Purpose**: Tracks asynchronous AI generation requests, status, and tokens.
- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`
  - `prompt text NOT NULL`: User natural language input.
  - `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed'))`
  - `target_scope text NOT NULL DEFAULT 'full_store' CHECK (target_scope IN ('full_store', 'theme_only', 'section'))`
  - `target_section_id text`
  - `error_message text`
  - `tokens_used int DEFAULT 0`
  - `created_at timestamptz NOT NULL DEFAULT now()`, `completed_at timestamptz`
- **RLS**: Store members can read and create generation jobs.

#### `public.design_assets`

- **Purpose**: Metadata for uploaded brand logos, hero videos, and AI-generated visuals.
- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`
  - `asset_type text NOT NULL CHECK (asset_type IN ('logo', 'banner', 'video', 'icon', 'cutout', 'pattern'))`
  - `storage_path text NOT NULL`
  - `mime_type text NOT NULL`
  - `metadata jsonb DEFAULT '{}'::jsonb`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **RLS**: Public read; store member upload and delete.

---

### 2.3 Store Settings & Configuration

#### `public.store_settings`

- **Purpose**: Multi-tenant replacement for the singleton `public.site_settings` table.
- **Primary Key**: `store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE`
- **Columns**:
  - `store_name text NOT NULL`
  - `logo_url text`
  - `contact_email text`: Private, exposed only to store admins.
  - `affiliate_disclosure text NOT NULL`
  - `footer_text text NOT NULL`
  - `social_links jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `currency text NOT NULL DEFAULT 'USD'`
  - `timezone text NOT NULL DEFAULT 'UTC'`
  - `updated_at timestamptz NOT NULL DEFAULT now()`
- **RLS**:
  - Public reads non-sensitive settings (via view `public_store_settings`).
  - Store admins can read and update all columns.

---

### 2.4 Multi-Tenant Affiliate Commerce Layer

#### `public.categories` (Refactored)

- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`
  - `name text NOT NULL`
  - `slug text NOT NULL`
  - `description text`
  - `image_url text`
  - `active boolean NOT NULL DEFAULT true`
  - `sort_order int NOT NULL DEFAULT 0`
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
- **Constraints**: **`UNIQUE(store_id, slug)`** (scoped per store!).
- **Indexes**: `CREATE INDEX categories_store_idx ON public.categories(store_id, active, sort_order);`
- **RLS**: Public read active categories for published stores; store admins write.

#### `public.products` (Refactored)

- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`
  - `name text NOT NULL`
  - `slug text NOT NULL`
  - `short_description text`, `description text`, `brand text`, `subcategory text`
  - `category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL`
  - `category_ids uuid[] NOT NULL DEFAULT '{}'`
  - `affiliate_url text NOT NULL`, `retailer text`, `retailer_product_id text`
  - `price numeric(12,2)`, `currency text DEFAULT 'USD'`
  - `price_updated_at timestamptz`
  - `featured boolean NOT NULL DEFAULT false`
  - `active boolean NOT NULL DEFAULT false`
  - `deleted_at timestamptz`
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
- **Constraints**:
  - **`UNIQUE(store_id, slug)`** (scoped per store!).
- **Indexes**:
  - `CREATE INDEX products_store_public_idx ON public.products(store_id, active, deleted_at, created_at DESC);`
  - `CREATE INDEX products_store_category_ids_idx ON public.products USING GIN(category_ids);`
  - `CREATE INDEX products_store_affiliate_lookup ON public.products(store_id, affiliate_url);`
- **Scoped Trigger**: `prevent_duplicate_affiliate_publishing`:
  Checks duplicate affiliate URLs strictly within `store_id`:
  ```sql
  WHERE p.store_id = NEW.store_id AND p.id IS DISTINCT FROM NEW.id AND p.affiliate_url = candidate_url
  ```

#### `public.product_images`, `product_features`, `product_tags`

- Retain existing column definitions, referencing `product_id uuid REFERENCES public.products(id) ON DELETE CASCADE`.
- Inherit tenant isolation via `product_id -> products.store_id`.

#### `public.collections`

- **Purpose**: Curated product groupings (e.g., "Trending Summer Looks", "Diwali Festival Gifts", "Desk Setups").
- **Primary Key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- **Columns**:
  - `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`
  - `name text NOT NULL`
  - `slug text NOT NULL`
  - `description text`
  - `product_ids uuid[] NOT NULL DEFAULT '{}'`
  - `sort_order int DEFAULT 0`
- **Constraints**: `UNIQUE(store_id, slug)`

#### `public.affiliate_clicks` (Refactored)

- **Columns**: `id uuid PRIMARY KEY`, `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`, `product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE`, `referrer text`, `user_agent text`, `created_at timestamptz DEFAULT now()`.

---

### 2.5 Billing, Metering & Audit

#### `public.subscriptions`

- **Columns**: `id uuid PRIMARY KEY`, `store_id uuid NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE`, `stripe_customer_id text`, `stripe_subscription_id text`, `plan text NOT NULL`, `status text NOT NULL`, `current_period_end timestamptz`.

#### `public.ai_usage_events`

- **Columns**: `id uuid PRIMARY KEY`, `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`, `user_id uuid REFERENCES auth.users(id)`, `tokens_input int`, `tokens_output int`, `cost_credits numeric(10,4)`, `action text`, `created_at timestamptz DEFAULT now()`.

#### `public.audit_logs`

- **Columns**: `id uuid PRIMARY KEY`, `store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE`, `user_id uuid REFERENCES auth.users(id)`, `action text NOT NULL`, `entity_type text`, `entity_id text`, `payload jsonb`, `created_at timestamptz DEFAULT now()`.
