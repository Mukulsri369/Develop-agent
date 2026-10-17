# 05 — Full Codebase Audit & System Architecture

## 1. Executive Overview & Purpose

This audit provides an evidence-based dissection of the existing single-tenant storefront codebase (**Our Visible Universe Store**) to architect its transformation into a multi-tenant, AI-generated affiliate ecommerce SaaS platform.

The analysis inspects actual source code, route lifecycles, database schemas, security policies, visual rendering pipelines, and data-flow interactions to identify high-value reusable assets and pinpoint hardcoded single-tenant assumptions.

---

## 2. End-to-End Request & Data Flow

### A. Public Storefront Request Lifecycle

1. **HTTP Ingestion**: Incoming visitor requests hit the Nitro/Node.js server running TanStack Start at `src/server.ts`.
2. **Global Middleware & CSRF Protection**: Handled by `src/start.ts`, attaching `attachSupabaseAuth` and evaluating `requestMiddleware` (`errorMiddleware`, `csrfMiddleware`).
3. **Route Matching & SSR Shell**:
   - `src/routes/__root.tsx` mounts the `<RootShell>` with HTML `<head>`, Google Fonts (`Instrument Serif`, `Manrope`, `JetBrains Mono`), global Tailwind stylesheet (`src/styles.css`), and dynamic SEO metadata.
   - TanStack Router matches file-based routes in `src/routes/_store.*`.
4. **Data Prefetching (`loader` & `useSuspenseQuery`)**:
   - Routes prefetch queries via TanStack React Query (`context.queryClient.ensureQueryData()`).
   - Storefront queries in `src/lib/store.ts` execute against `publicDb()` (`src/integrations/supabase/client.ts`), querying active products (`active = true AND deleted_at IS NULL`), active categories, and `public_site_settings`.
5. **Component Hydration & Progressive Rendering**:
   - Server returns complete HTML for SEO and initial paint.
   - Client hydrates; `src/router.tsx` rehydrates `queryClientState`.
   - Dynamic interactive modules mount on the client: Three.js WebGL scene (`GalaxyScene.tsx`) loads asynchronously via `import("three")` with reduced-motion and offscreen-pause checks; Motion animations trigger on scroll in `PlanetHero.tsx` and `CelestialScrollWorld.tsx`.

### B. Admin Console Request Lifecycle

1. **Access Gate (`src/routes/_admin.tsx`)**:
   - Client-side route guard sets `ssr: false`.
   - `beforeLoad` invokes `supabase.auth.getUser()`. If no session is active, redirects to `/admin/login`.
   - Calls PostgreSQL RPC `is_admin()`. If false, signs user out and redirects to `/admin/login?denied=1`.
2. **Administrative Mutation & RLS Validation**:
   - Admin writes (product creation, edit, category changes, settings) call Supabase using the authenticated user JWT.
   - PostgreSQL RLS policies evaluate `public.is_admin()`, confirming the user's email matches an active record in `public.admins`.
   - Storage uploads (`src/lib/admin.ts`) validate image dimensions and MIME types, downscale to WebP via `<canvas>`, and write directly to `storage.objects` in the `store-images` bucket.

---

## 3. Reusable Business Subsystems

### A. Product Catalog Subsystem

- **Files**: `src/lib/store.ts`, `src/lib/product-categories.ts`, `src/components/store/ProductCard.tsx`, `src/components/store/ProductDetailView.tsx`, `src/components/admin/ProductForm.tsx`, `src/routes/_admin.admin.products.*.tsx`.
- **Capabilities**:
  - Full CRUD with draft (`active = false`), published (`active = true`), and soft-deleted (`deleted_at IS NOT NULL`) lifecycle states.
  - Multi-category support stored atomically in indexed `category_ids uuid[]` arrays with automatic fallback to single `category_id`.
  - Multi-image galleries with main display, thumbnails, alt text, and ordering.
  - Bullet-point feature lists (`product_features`) and searchable keywords (`product_tags`).
  - Intelligent relevance search scoring engine in `src/lib/store.ts` (`computeProductRelevance`) prioritizing title, short description, and brand over long descriptions with stop-word exclusion and whole-word bonus weights.

### B. Affiliate & Retailer Integration Subsystem

- **Files**: `src/lib/retailer-price.ts`, `src/lib/retailer-currency.ts`, `src/lib/duplicate-detector.ts`, `src/routes/api/admin/scrape-product.ts`, `src/routes/api/admin/check-price.ts`, `src/components/store/BuyButton.tsx`.
- **Capabilities**:
  - Retailer-neutral affiliate URL architecture supporting Amazon, Flipkart, Ubuy, and arbitrary custom merchants.
  - Headless scraping via Cheerio extracting JSON-LD schema, buy-box prices, primary images, high-res upgrades (e.g. `._SL1500_.`), and brand tags from live product links.
  - Currency normalization across INR (`₹`), USD (`$`), EUR (`€`), GBP (`£`), CAD, AUD, JPY, and AED.
  - Non-blocking outbound click logging to `public.outbound_clicks`.
  - Duplicate detection blocking identical affiliate link publishing across the catalog.

### C. Admin Operations & Management Subsystem

- **Files**: `src/routes/_admin.admin.index.tsx`, `src/routes/_admin.admin.categories.tsx`, `src/routes/_admin.admin.duplicates.tsx`, `src/routes/_admin.admin.festival.tsx`, `src/routes/_admin.admin.settings.tsx`, `src/components/admin/CategorySelect.tsx`.
- **Capabilities**:
  - Store overview metrics and duplicate URL scanner.
  - Category tree management with drag/sort ordering and spotlight assignments.
  - Multi-admin email approvals via `public.admins` and `is_approved_admin_email`.
  - Client-side image optimization pipeline resizing images to max 1600px WebP before upload.

---

## 4. Single-Tenant vs. Multi-Tenant Gap Analysis

| Architectural Dimension       | Existing Single-Tenant Implementation                                                                   | Multi-Tenant SaaS Requirement                                                                                     | Refactoring Needed                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Database Ownership**        | Single shared database with no `store_id` or `tenant_id` columns.                                       | Every product, category, image, setting, and click must be isolated by `tenant_id`.                               | Add `tenant_id uuid NOT NULL REFERENCES public.tenants(id)` to all operational tables with RLS scoping. |
| **Store Settings**            | `site_settings` table hardcoded with singleton check `id int PRIMARY KEY CHECK (id = 1)`.               | Dynamic tenant settings row per store (`tenant_id PRIMARY KEY`).                                                  | Migrate singleton `id = 1` to multi-tenant settings keyed by `tenant_id` or subdomain slug.             |
| **Domain & Tenant Routing**   | Fixed root route `/_store` serving one catalog.                                                         | Subdomain (`subdomain.platform.com`), custom domain, or path prefix (`/store/$slug`).                             | Introduce tenant resolution middleware in `src/server.ts` or router route prefix.                       |
| **Admin Authorization**       | Global `is_admin()` checks if email is in `public.admins`.                                              | Scoped tenant permissions (store owners manage only their own store).                                             | Multi-tenant RBAC table `tenant_members` (user_id, tenant_id, role) with scoped RLS.                    |
| **Affiliate Link Uniqueness** | PostgreSQL trigger `prevent_duplicate_affiliate_publishing` checks global uniqueness across all stores. | Uniqueness must be scoped per tenant (`WHERE tenant_id = NEW.tenant_id`).                                         | Update trigger to evaluate uniqueness within the same store instance.                                   |
| **Storage Isolation**         | All images uploaded to single `store-images` bucket under `products/`, `categories/`, `branding/`.      | Isolated tenant prefixes: `store-images/{tenant_id}/products/...`.                                                | Enforce path prefixing in `src/lib/admin.ts` and storage RLS.                                           |
| **Theme & Branding**          | Hardcoded deep-space CSS theme, planet hero, and celestial catalog.                                     | Dynamic theme configuration engine injecting colors, fonts, layout blocks, and industry-specific hero components. | Keep astronomy as Tenant 0 / reference theme; create theme provider and design token injector.          |
