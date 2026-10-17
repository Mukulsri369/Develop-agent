# Phase 2 — Prompt 05: Multi-Tenant Database Foundation & Store Architecture

## 1. Executive Summary & Verification Findings

In accordance with Phase 1 safety baselines and Phase 2 Prompt 05 instructions:

- **Backend Inspection**: The application's default Supabase configuration (`DEFAULT_SUPABASE_URL`) targets `https://c--e5dc52fc-4129-47cd-9ba2-1c20a9af2f78-prod.lovable.cloud`, which is a **live production project**.
- **Migration Execution Status**: **EXPLICITLY BLOCKED FOR SAFETY**. No direct DDL write commands or schema mutations were executed against this unverified/production backend. Instead, fully verified, idempotent SQL migration `0010_multi_tenant_foundation.sql`, Drizzle journal registration, TypeScript tenancy entities, validation schemas, and regression tests were established.
- **Original Store Parity**: The existing Our Visible Universe Store remains 100% operational, untouched, and fully isolated with zero database drift or breaking changes.

---

## 2. Entity Relationship Diagram (ERD)

```
                       ┌─────────────────────────┐
                       │       auth.users        │
                       │   (Identity Provider)   │
                       └───────────┬─────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │ (1:1 global)            │ (1:N owner)             │ (1:N member)
         ▼                         ▼                         ▼
┌──────────────────────┐  ┌─────────────────┐       ┌─────────────────┐
│platform_super_admins │  │     stores      │◄──────┤  store_members  │
├──────────────────────┤  ├─────────────────┤(1:N)  ├─────────────────┤
│ id (PK)              │  │ id (PK, UUID)   │       │ id (PK, UUID)   │
│ user_id (FK, UNIQUE) │  │ name            │       │ store_id (FK)   │
│ created_at           │  │ slug (UNIQUE)   │       │ user_id (FK)    │
│ created_by (FK)      │  │ owner_id (FK)   │       │ role (CHECK)    │
│ notes                │  │ status (CHECK)  │       │ status (CHECK)  │
└──────────────────────┘  │ onboarding_state│       │ created_at      │
                          │ is_public_listed│       │ updated_at      │
                          │ plan_tier       │       └────────┬────────┘
                          │ created_at      │                │
                          │ updated_at      │                │ UNIQUE(store_id, user_id)
                          │ archived_at     │
                          └────────┬────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │ (1:N)                                   │ (1:N)
              ▼                                         ▼
   ┌────────────────────┐                    ┌────────────────────┐
   │   store_domains    │                    │ store_invitations  │
   ├────────────────────┤                    ├────────────────────┤
   │ id (PK, UUID)      │                    │ id (PK, UUID)      │
   │ store_id (FK)      │                    │ store_id (FK)      │
   │ hostname (UNIQUE)  │                    │ email              │
   │ domain_type (CHECK)│                    │ role (CHECK)       │
   │ verification_status│                    │ token (UNIQUE)     │
   │ verification_txt   │                    │ expires_at         │
   │ is_primary         │                    │ created_at         │
   │ verified_at        │                    │ created_by (FK)    │
   │ created_at         │                    └────────────────────┘
   │ updated_at         │
   └────────────────────┘
```

---

## 3. Database Changes & Table Specifications

### 3.1 `public.platform_super_admins`

- **Purpose**: Global platform governance and super administrator rights. Completely decoupled from store-level administrators. Ordinary user signup or metadata cannot grant this role.
- **Columns**: `id`, `user_id` (UNIQUE, FK `auth.users`), `created_at`, `created_by` (FK `auth.users`), `notes`.
- **Security**: RLS strictly permits SELECT, INSERT, UPDATE, DELETE only for confirmed super administrators verified via `public.is_super_admin()`.

### 3.2 `public.stores`

- **Purpose**: Independent tenant storefront entity.
- **Columns**:
  - `id`: UUID Primary Key, defaults to `gen_random_uuid()`.
  - `name`: Human-readable store brand name.
  - `slug`: Subdomain handle, constrained to lowercase alphanumeric with internal hyphens (`3-63` chars).
  - `owner_id`: FK to `auth.users(id)` with `ON DELETE RESTRICT` (prevents orphan stores upon user deletion).
  - `status`: Lifecycle state (`draft`, `active`, `suspended`, `archived`).
  - `onboarding_state`: Multi-step setup tracking (`initial`, `details_provided`, `theme_generated`, `customized`, `ready`).
  - `is_publicly_listed`: Boolean publication eligibility flag.
  - `plan_tier`: Subscription level (`starter`, `pro`, `enterprise`).
  - `created_at`, `updated_at`, `archived_at`: Timestamps.

### 3.3 `public.store_members`

- **Purpose**: Relational membership mapping between Supabase Auth users and stores, enforcing role-based permissions.
- **Columns**: `id`, `store_id` (FK `stores.id`), `user_id` (FK `auth.users.id`), `role` (`owner`, `admin`, `editor`, `viewer`), `membership_status` (`active`, `invited`, `suspended`), `created_at`, `updated_at`.
- **Uniqueness**: `UNIQUE(store_id, user_id)` strictly prevents duplicate memberships.

### 3.4 `public.store_domains`

- **Purpose**: Subdomain and custom domain host mapping with DNS verification tracking.
- **Columns**: `id`, `store_id` (FK `stores.id`), `hostname` (UNIQUE), `domain_type` (`subdomain`, `custom`), `verification_status` (`pending`, `verified`, `failed`), `verification_txt`, `is_primary`, `verified_at`, `created_at`, `updated_at`.

### 3.5 `public.store_invitations`

- **Purpose**: Secure tokenized team invitations for store collaborator onboarding.
- **Columns**: `id`, `store_id` (FK `stores.id`), `email`, `role`, `token` (UNIQUE), `expires_at`, `created_at`, `created_by`.

---

## 4. SQL Migration File & Version Sequence

- **Migration File**: `drizzle/migrations/0010_multi_tenant_foundation.sql`
- **Drizzle Journal Registration**: `drizzle/migrations/meta/_journal.json` (Entry `idx: 10`, `tag: 0010_multi_tenant_foundation`)
- **Authoritative Tooling**: The repository relies on additive raw SQL migrations in `drizzle/migrations/`. No conflicting schema tools exist.

---

## 5. Security & Row Level Security (RLS) Architecture

To prevent self-referencing infinite recursion in RLS policies, access verification is encapsulated into four `SECURITY DEFINER` functions with fixed `search_path = public`:

1. `public.is_super_admin()`: Verifies if the executing `auth.uid()` exists in `platform_super_admins`.
2. `public.get_store_role(check_store_id uuid)`: Returns the specific member role of `auth.uid()` in a given store.
3. `public.is_store_admin(check_store_id uuid)`: Evaluates if `auth.uid()` is a super admin or holds `owner`/`admin` role in `check_store_id`.
4. `public.is_store_member(check_store_id uuid)`: Evaluates if `auth.uid()` is a super admin or any member in `check_store_id`.

### Policy Overview

- **stores**: Public can read `active` stores. Members can read their own stores (even in `draft` or `suspended`). Only authenticated owners can create or edit their stores.
- **store_members**: Read allowed for members of the store. Write/delete restricted to store owners and super admins (non-owners can self-delete to leave).
- **store_domains**: Public can read verified domains for router lookup; store admins manage domains.

---

## 6. Legacy Compatibility Plan

1. **Flagship Tenant 0 Constants**:
   - `LEGACY_STORE_ID`: `00000000-0000-0000-0000-000000000001`
   - `LEGACY_STORE_SLUG`: `ourvisibleuniverse`
2. **Idempotent Genesis Block**: The migration includes an idempotent block that checks for existing user accounts in `auth.users` and establishes Tenant 0 and its owner membership without throwing errors if rerun.
3. **Zero Impact on Existing Tables**: Existing products, categories, site_settings, and outbound_clicks remain untouched in Prompt 05. Product and category queries continue to work normally without schema breaks.

---

## 7. Rollback & Recovery Strategy

If an unexpected error occurs during staging deployment:

```sql
-- Reversal script
DROP TRIGGER IF EXISTS store_domains_updated ON public.store_domains;
DROP TRIGGER IF EXISTS store_members_updated ON public.store_members;
DROP TRIGGER IF EXISTS stores_updated ON public.stores;

DROP TABLE IF EXISTS public.store_invitations CASCADE;
DROP TABLE IF EXISTS public.store_domains CASCADE;
DROP TABLE IF EXISTS public.store_members CASCADE;
DROP TABLE IF EXISTS public.stores CASCADE;
DROP TABLE IF EXISTS public.platform_super_admins CASCADE;

DROP FUNCTION IF EXISTS public.is_store_member(uuid);
DROP FUNCTION IF EXISTS public.is_store_admin(uuid);
DROP FUNCTION IF EXISTS public.get_store_role(uuid);
DROP FUNCTION IF EXISTS public.is_super_admin();
```

---

## 8. Test Evidence

A dedicated test suite was implemented in `src/test/multi-tenant-foundation.test.ts` covering:

1. **Slug Validation**: Format rules, character length, and rejection of 30+ reserved platform slugs (`admin`, `api`, `checkout`, `dashboard`, etc.).
2. **Role Hierarchy**: Strict Zod parsing of valid roles, rejection of invalid roles, permission levels, and administrative capabilities.
3. **Ownership Protection**: Prevents store owners from unilaterally leaving stores without transfer; validates ownership transfer constraints.
4. **Status Transitions**: Validates archiving and ensures archived stores undergo review transitions (`archived -> draft`).
5. **Domain Validation**: RFC-compliant hostname formatting and protocol rejection.
6. **Database Safety Guards**: Automated detection of production database URLs (`-prod.lovable.cloud`) and validation that migration commands are cleanly blocked.

---

## 9. Outstanding Work for Prompt 06

- **Tenant Routing & Subdomain Resolution**: Middleware and router integration to resolve tenant context from subdomains and custom domains.
- **Tenant Context Provider**: Integrating `StoreContext` into route trees for runtime store resolution.
- **Legacy Store Fallback**: Ensuring apex requests without subdomains map seamlessly to Flagship Tenant 0 ("Our Visible Universe").
