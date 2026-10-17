# Phase 2 — Prompt 09: Tenant-Specific Store Settings and Brand Configuration

## 1. Executive Summary & Goals

This phase transitions the platform from a single global `site_settings` table (constrained to `id = 1`) to a robust, store-scoped configuration system (`public.store_settings`). Every tenant store operates as an independent commercial brand with its own identity, contact information, social profiles, affiliate configuration, content pages, seasonal promotions, and feature flags—while completely preserving the original "Our Visible Universe" astronomy store.

### Key Objectives Achieved:

1. **Per-Store Settings Entity**: Introduced `public.store_settings` with a strict `1-to-1` foreign-key relationship to `public.stores(id)` with cascading deletion.
2. **Tenancy Boundary & RLS**: RLS policies prevent Store A administrators from reading or modifying Store B settings. Uninvited visitors only receive sanitized public configuration.
3. **Lossless Migration of Astronomy Store**: Flagship Tenant 0 (`00000000-0000-0000-0000-000000000001`) retains its full name ("Our Visible Universe"), astronomy category, logo, copy, Amazon Associate disclosures, and festival special configurations.
4. **Separation of Concerns**: Kept business/commercial configuration distinct from visual design specifications (colors, Three.js shaders, celestial meshes).
5. **Auto-Provisioning**: Newly registered stores automatically receive baseline settings via a database trigger (`auto_create_store_settings`).
6. **Immutable Store Identity Protection**: A database trigger prevents reassigning or tampering with `store_id` on update.

---

## 2. Analysis of Existing Settings & Global Assumptions Removed

| Legacy Assumption             | Prior Implementation                                                                     | New Multi-Tenant Architecture                                                                                        |
| :---------------------------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| **Singleton Record**          | `public.site_settings` with `CHECK (id = 1)`                                             | `public.store_settings` with `store_id uuid PRIMARY KEY REFERENCES public.stores(id)`                                |
| **Overloaded Social Links**   | Stored `approved_admins`, `festival_product_ids`, and spotlights in `social_links` JSONB | First-class columns: `promotions` JSONB, `feature_flags` JSONB, and team memberships in `store_members`              |
| **Global Brand Name**         | Hardcoded or read from singleton ID 1                                                    | Tenant-scoped `store_name`, `tagline`, `store_description`, and `business_category`                                  |
| **Universal Disclosure**      | Hardcoded Amazon Associate text for all stores                                           | Per-store `affiliate_disclosure`, `supported_retailers`, and `affiliate_config`                                      |
| **Shared Contact Channel**    | Single `contact_email` leaked across queries                                             | Private `contact_email`/`support_email` hidden from public view; public `support_url` & `contact_details` exposed    |
| **Universal Astronomy Theme** | Astronomy hardcoded across all routes                                                    | Configurable `business_category`, with Tenant 0 defaulting to astronomy and future tenants supporting general retail |

---

## 3. Database Schema & Migration Specification (`0013_tenant_store_settings.sql`)

### Table Structure: `public.store_settings`

```sql
CREATE TABLE public.store_settings (
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
```

### Public Sanitized View: `public.public_store_settings`

```sql
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
```

### Auto-Creation Trigger

```sql
CREATE OR REPLACE FUNCTION public.auto_create_store_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.store_settings (
    store_id, store_name, tagline, store_description, business_category, footer_text, affiliate_disclosure, promotions, feature_flags
  ) VALUES (
    NEW.id, NEW.name, 'Curated products for extraordinary minds.', 'Discover curated items and gear from top retailers.',
    'general', 'Explore the catalog. Discover extraordinary products.',
    'When you buy through links on this site, we may earn an affiliate commission at no extra cost to you.',
    '{"bannerEnabled": false}'::jsonb, '{"enable_festival": false, "enable_spotlights": true}'::jsonb
  ) ON CONFLICT (store_id) DO NOTHING;
  RETURN NEW;
END;
$$;
```

---

## 4. Tenant 0 Preservation Strategy

To guarantee that "Our Visible Universe" suffers zero downtime, regressions, or cosmetic disruptions:

1. Migration 0013 backfills from `public.site_settings WHERE id = 1` into Tenant 0's row (`00000000-0000-0000-0000-000000000001`).
2. `DEFAULT_ASTRONOMY_STORE_SETTINGS` in `src/platform/settings/constants.ts` codifies the complete brand copy, affiliate notices, festival configuration, and astronomy theme assets.
3. `StoreSettingsService.getPublicSettings(LEGACY_STORE_ID)` checks `public.store_settings` and falls back to `public.site_settings` and the authoritative astronomy defaults.
4. Legacy routes and admin panels (`_admin.admin.settings.tsx` and `_admin.admin.festival.tsx`) dual-write to both `store_settings` and `site_settings`.

---

## 5. Row Level Security & Authorization Matrix

| Actor              | Operation         | Target Table               | Condition / Policy                    | Result                                                   |
| :----------------- | :---------------- | :------------------------- | :------------------------------------ | :------------------------------------------------------- |
| **Public Visitor** | SELECT            | `public_store_settings`    | `store_is_active(store_id)`           | **ALLOWED** (Sanitized fields only)                      |
| **Public Visitor** | SELECT            | `store_settings`           | `is_store_member(store_id)`           | **BLOCKED** (Private contact channels hidden)            |
| **Public Visitor** | UPDATE/INSERT     | `store_settings`           | Authenticated store admin only        | **BLOCKED**                                              |
| **Store Editor**   | SELECT            | `store_settings`           | `is_store_member(store_id)`           | **ALLOWED**                                              |
| **Store Editor**   | UPDATE            | `store_settings`           | `is_store_admin(store_id)`            | **BLOCKED** (Editor cannot alter store identity/billing) |
| **Store Admin A**  | UPDATE            | `store_settings` (Store A) | `is_store_admin(store_id)`            | **ALLOWED**                                              |
| **Store Admin A**  | UPDATE            | `store_settings` (Store B) | `is_store_admin(store_id)`            | **BLOCKED** (Cross-tenant violation)                     |
| **Store Admin A**  | UPDATE `store_id` | `store_settings` (Store A) | `trg_prevent_settings_store_mutation` | **BLOCKED** (Immutable store_id)                         |
| **Store Owner**    | DELETE            | `store_settings`           | `is_store_owner(store_id)`            | **ALLOWED**                                              |

---

## 6. Frontend Integration & Services

### `StoreSettingsService` (`src/platform/settings/service.ts`)

- `getPublicSettings(storeId)`: Resolves public store settings with caching and graceful fallbacks.
- `getAdminSettings(storeId, context)`: Retrieves full administrative settings for authorized team members.
- `updateSettings(storeId, updates, context)`: Verifies store admin permissions, enforces immutable fields, and persists settings.

### React Hooks (`src/platform/settings/hooks.ts`)

- `usePublicStoreSettings(storeId?)`: React hook providing reactive public store settings for storefront rendering.
- `useAdminStoreSettings(storeId?)`: React hook for store management dashboards.
- `useUpdateStoreSettings(storeId?)`: Mutation hook invalidating relevant caches across admin and storefront queries.

---

## 7. Verification & Test Evidence

The automated test suite (`src/test/tenant-store-settings.test.ts`) verifies all requirements across 5 distinct domains:

1. **Tenant 0 Preservation**: Verified exact astronomy name, tagline, Amazon disclosure, and cosmic festival special.
2. **Multi-Tenant Isolation**: Verified independent brand identities, currencies (EUR vs USD), categories (home_decor vs gaming), and social links between Store A and Store B.
3. **Public Sanitization**: Verified that `contact_email` and `support_email` are omitted from the public view.
4. **Cross-Tenant RLS Enforcement**: Verified that Store A Admin cannot update Store B settings, Store Editor cannot update store settings, and `store_id` mutations are rejected.
5. **Promotional & Retailer Configuration**: Verified custom festival specials, promotional banners, and custom retailer configurations.
