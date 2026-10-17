# 02 — Environment & Dependencies Analysis

## 1. Runtime Environment Specifications

- **Operating System**: Linux x64 (containerized sandbox environment).
- **Node.js**: v22.
- **Package Manager**: `npm` only (v10+). Lockfiles from `yarn`, `pnpm`, and `bun` are strictly prohibited per AI Studio runtime rules (`bun.lock` was purged during Phase 1 baseline).
- **Network Interface**:
  - Bound to `0.0.0.0:3000`.
  - Only HTTP/HTTPS outbound connections are permitted. Direct TCP connections to external database servers are blocked by network sandbox policy.
  - Development access is multiplexed via reverse-proxy iframe.

---

## 2. Dependency Audit & Compatibility

### Critical Dependencies Confirmed

| Package                  | Version    | Compatibility Assessment                                                     | Action / Guard                                                         |
| ------------------------ | ---------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `react` & `react-dom`    | `^19.2.0`  | Compatible with TanStack Start & React 19 concurrent features.               | Retained without modification.                                         |
| `@tanstack/react-start`  | `1.168.60` | Full-stack server framework handling SSR and server functions.               | Requires server entry point at `src/server.ts`.                        |
| `@tanstack/react-router` | `1.170.41` | Client/SSR routing with automatic code generation in `src/routeTree.gen.ts`. | Router routes defined in `src/routes/`.                                |
| `@supabase/supabase-js`  | `^2.117.2` | Client and Server SDK for Postgres queries, RLS evaluation, RPC, and Auth.   | Proxied in `client.ts` and `client.server.ts`.                         |
| `three` & `@types/three` | `^0.186.1` | WebGL 3D galaxy scene in storefront.                                         | Dynamically imported after mount in `GalaxyScene.tsx` with SSR guards. |
| `motion`                 | `^14.1.0`  | Declarative animations for hero planets, transitions, modals.                | SSR safe, obeys `prefers-reduced-motion`.                              |
| `cheerio`                | `^1.2.0`   | HTML scraping for Amazon & Flipkart product/price auto-import.               | Uses `cheerio.load(html)` in server route handlers.                    |
| `@tailwindcss/vite`      | `^4.2.1`   | Native Vite integration for Tailwind CSS v4.                                 | `@import "tailwindcss";` in `src/styles.css`.                          |

### Package Hygiene & Cleanup Performed

- **Purged**: Extraneous `bun.lock` file removed from project root to ensure clean `npm` dependency resolution.
- **Fixed Type Assertions**: Removed untyped `any` casts in `src/router.tsx`, `src/routes/admin.login.tsx`, and `src/routes/api/admin/scrape-product.ts`.
- **Timer Scoping**: Fixed `prefer-const` issue in `previewAuthStorage.ts`.

---

## 3. Environment Configuration Contract

The application reads backend configuration from environment variables, falling back to bundled defaults if unset:

```bash
# ==============================================================================
# ENVIRONMENT CONFIGURATION CONTRACT (docs/saas/02-environment-and-dependencies.md)
# All sensitive variables below must be supplied via secure environment variables.
# ==============================================================================

# Supabase Project Credentials (Client & Public SSR)
VITE_SUPABASE_URL=https://[YOUR-DEV-PROJECT].supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_[YOUR-DEV-ANON-KEY]
VITE_SUPABASE_PROJECT_ID=[YOUR-DEV-PROJECT-ID]

# Supabase Server-Side Admin Credentials (Server Functions & Private Storage Proxy)
# SECURITY: Never expose SUPABASE_SERVICE_ROLE_KEY to client bundles or browser code!
SUPABASE_URL=https://[YOUR-DEV-PROJECT].supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_[YOUR-DEV-ANON-KEY]
SUPABASE_PROJECT_ID=[YOUR-DEV-PROJECT-ID]
SUPABASE_SERVICE_ROLE_KEY=sb_secret_[YOUR-DEV-SERVICE-ROLE-KEY]

# Lovable Cron Security Token (Required for scheduled price checks)
LOVABLE_CRON_SECRET=[SECURE_RANDOM_CRON_TOKEN]
LOVABLE_CRON_SECRET_PREVIOUS=[OPTIONAL_ROTATION_CRON_TOKEN]

# Gemini AI Engine (Required for SaaS Store Generation & Natural Language Store Builder)
GEMINI_API_KEY=[YOUR-GEMINI-API-KEY]
```

### Risk & Isolation Classification:

1. **Current Status**: The codebase contains bundled fallback credentials pointing to `https://c--e5dc52fc-4129-47cd-9ba2-1c20a9af2f78-prod.lovable.cloud` and project ID `qkmvundbkauaeqkmijeh`.
2. **Classification**: **Production Lovable Cloud Backend**.
3. **Constraint**: **NO DESTRUCTIVE DDL/DML OPERATIONS ALLOWED**. Any data writes against these defaults would pollute the live affiliate store.
