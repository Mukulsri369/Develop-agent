# 10 — Master SaaS Architecture & System Design Blueprint

## 1. Architectural Vision & Core Principles

The platform transforms the working Our Visible Universe affiliate storefront into a multi-tenant AI-driven SaaS platform. Any creator, influencer, or entrepreneur can describe their niche (clothing, sneakers, consumer electronics, home décor, cosmetics, astronomy) in natural language and receive a production-grade, highly styled, conversion-optimized storefront with working affiliate commerce mechanics, managed via a unified administrative console.

### Non-Negotiable Architectural Tenets

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       NON-NEGOTIABLE ARCHITECTURAL TENETS                   │
├───────────────────────────────┬─────────────────────────────────────────────┤
│ 1. One Platform, Many Stores  │ Multi-tenant: shared codebase, single app,  │
│                               │ isolated tenant data & RLS boundaries.      │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 2. Maximum Admin Panel Reuse  │ Preserve working product CRUD, scraping,    │
│                               │ image optimization, and duplicate detector. │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 3. Design Independence        │ Brand & layout decoupled from space theme;  │
│                               │ space preserved as flagship "Tenant 0".     │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 4. Deterministic AI Engine    │ AI outputs validated JSON design specs;     │
│                               │ NO arbitrary runtime JS execution.          │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 5. Strict Zero-Trust Security │ Server-enforced tenant RLS, SSRF-guarded    │
│                               │ scraping, tenant-prefixed storage buckets.  │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 6. Zero Downtime Evolution    │ Additive migrations, dual-read compatibility│
│                               │ preserving historical affiliate links.      │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

---

## 2. High-Level Modular Decomposition

To eliminate circular dependencies and maintain clean separation of concerns, the application is divided into seven decoupled functional modules:

```
                      ┌─────────────────────────────────┐
                      │    MODULE A: PLATFORM CORE      │
                      │  Auth, Tenants, Members, Subscr │
                      └──────────────┬──────────────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           ▼                         ▼                         ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│ MODULE G: BILLING   │   │ MODULE E: AI ENGINE │   │ MODULE F: PUBLISHING│
│ Metering, AI Credits│   │ Gemini, Specs, Diffs│   │ Domains, DNS, SEO   │
└──────────┬──────────┘   └──────────┬──────────┘   └──────────┬──────────┘
           │                         │                         │
           └─────────────────────────┼─────────────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
┌─────────────────────────────────────┐     ┌─────────────────────────────────────┐
│  MODULE C: AFFILIATE COMMERCE       │     │     MODULE B: STOREFRONT ENGINE     │
│  Products, Categories, Links, Clicks│◄────┤  Design Spec, Registry, Renderers   │
└──────────────────┬──────────────────┘     └──────────────────┬──────────────────┘
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         ▼
                            ┌────────────────────────┐
                            │ MODULE D: ADMIN ENGINE │
                            │ Dashboard, CRUD, Media │
                            └────────────────────────┘
```

### Module Responsibilities & Boundary Contracts

#### Module A: Platform Core

- **Responsibilities**: Global identity (Supabase Auth), tenant directory (`stores`), multi-store membership (`store_members`), role-based access control, tenant resolution middleware, platform-wide audit logging.
- **Inbound Dependencies**: Supabase Auth SDK.
- **Outbound Exports**: `TenantContext`, `resolveTenantByHost()`, `useCurrentStore()`, `isTenantAdmin()`.

#### Module B: Storefront Engine

- **Responsibilities**: Universal design specification interpreter, component registry, dynamic theme token injector (CSS variables), layout rendering (heroes, grids, carousels), responsive viewports, dynamic meta tags.
- **Inbound Dependencies**: Reads design specifications from Module F/E, product queries from Module C.
- **Outbound Exports**: `<StorefrontRenderer />`, `<ThemeTokenProvider />`, component catalog definitions.

#### Module C: Affiliate Commerce Engine

- **Responsibilities**: Multi-tenant product catalog, atomic multi-category taxonomy (`category_ids`), retailer-neutral affiliate link resolver, click tracking, price scraper, currency formatter (`retailer-currency.ts`).
- **Inbound Dependencies**: `tenant_id` from Module A.
- **Outbound Exports**: `listStoreProducts()`, `getStoreProductBySlug()`, `trackAffiliateClick()`.

#### Module D: Admin Engine

- **Responsibilities**: Reusable administrative console, product creation/editing (`ProductForm.tsx`), image resizing and WebP optimization (`admin.ts`), duplicate URL inspection, store branding settings.
- **Inbound Dependencies**: Permissions from Module A, commerce services from Module C, storage APIs.
- **Outbound Exports**: `/_admin/` route tree and management components.

#### Module E: AI Design Engine

- **Responsibilities**: Natural-language prompt parsing, design intent extraction, structured JSON design spec generation via Gemini API, section-by-section diffing, design version history.
- **Inbound Dependencies**: Server-side `@google/genai` SDK, schema validator (Zod) from Module B, metering checks from Module G.
- **Outbound Exports**: `generateStoreDesign()`, `refineSectionDesign()`, `rollbackDesignVersion()`.

#### Module F: Publishing & Domain Engine

- **Responsibilities**: Draft vs. published design state isolation, platform subdomain routing (`*.ourvisibleuniverse.store` or `*.platform.com`), custom CNAME domain verification, dynamic sitemap and robots.txt generation.
- **Inbound Dependencies**: Stores from Module A, designs from Module E/B.
- **Outbound Exports**: `publishStoreDesign()`, `verifyCustomDomain()`, `getPublishedDesign()`.

#### Module G: Billing & Metering Engine

- **Responsibilities**: Subscription plan tiers (Starter, Pro, Enterprise), AI token/credit tracking, store generation quotas, scraper rate-limit metering.
- **Inbound Dependencies**: Stripe / payment webhook handlers, usage events from Module E and C.
- **Outbound Exports**: `checkAiQuota()`, `recordUsageEvent()`, `getStoreSubscription()`.

---

## 3. Target Directory Structure

```
/app/applet/
├── drizzle/                             # PostgreSQL migrations
│   ├── migrations/                      # 0000-0009 (historical) + 0010+ (multi-tenant)
│   └── schema.ts                        # Authoritative multi-tenant Drizzle schema
├── docs/saas/                           # Architectural blueprints & specifications
├── src/
│   ├── components/
│   │   ├── admin/                       # Reusable admin UI (ProductForm, CategorySelect)
│   │   ├── common/                      # Shared universal primitives
│   │   ├── registry/                    # Universal Storefront Component Registry
│   │   │   ├── heroes/                  # EditorialHero, CinematicHero, VideoHero, PlanetHero
│   │   │   ├── grids/                   # ProductGrid, BentoGrid, MasonryGrid
│   │   │   ├── rails/                   # ProductScrollRail, CategoryRail
│   │   │   ├── showcases/               # ThreeCanvasShowcase, SpotlightShowcase
│   │   │   ├── story/                   # BrandStory, TestimonialSection
│   │   │   └── footers/                 # MinimalFooter, EditorialFooter, MultiColFooter
│   │   ├── ui/                          # 35+ Radix/shadcn UI primitives
│   │   └── canvas/                      # Three.js lifecycle wrapper & WebGL scenes
│   ├── lib/
│   │   ├── ai/                          # Gemini API prompts, tools, structured schemas
│   │   ├── commerce/                    # Products, categories, search ranking, click tracking
│   │   ├── retailer/                    # Buy-box parsing, currency detection, link sanitization
│   │   ├── tenant/                      # Tenant resolution, context, domain matching
│   │   ├── theme/                       # Design specification schema, CSS variable injector
│   │   └── utils.ts                     # Common helpers
│   ├── routes/
│   │   ├── _admin/                      # Multi-tenant admin workspace
│   │   │   ├── _admin.store.$storeId.products.tsx
│   │   │   ├── _admin.store.$storeId.design.tsx
│   │   │   ├── _admin.store.$storeId.settings.tsx
│   │   │   └── _admin.store.$storeId.analytics.tsx
│   │   ├── _platform/                   # SaaS customer portal (signup, dashboard, billing)
│   │   ├── _storefront/                 # Dynamic public storefront router
│   │   │   ├── $storeSlug.index.tsx     # Subdomain / path storefront root
│   │   │   ├── $storeSlug.shop.tsx      # Paginated catalog
│   │   │   ├── $storeSlug.product.$id.tsx
│   │   │   └── $storeSlug.category.$cat.tsx
│   │   ├── api/
│   │   │   ├── admin/                   # Authenticated admin endpoints (SSRF-protected scrape)
│   │   │   ├── ai/                      # Server-side Gemini design generation endpoints
│   │   │   └── public/                  # Public image proxy & tracking endpoints
│   │   └── __root.tsx                   # Full-stack root shell
│   ├── server.ts                        # Nitro entry with tenant resolution hooks
│   ├── start.ts                         # TanStack Start instance with tenant & auth middleware
│   └── styles.css                       # Base Tailwind v4 configuration & theme anchors
```
