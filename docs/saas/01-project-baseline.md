# 01 — Project Baseline & Source Architecture

## 1. Executive Summary & Purpose

This document establishes the verified baseline of the imported codebase (**Our Visible Universe Store**, imported from repository `Mukulsri369/ourvisibleuniversestore`) as the foundation for transition into a multi-tenant AI-powered SaaS affiliate ecommerce platform.

Per Prompt 01 specifications, **no SaaS features, database migrations, or UI redesigns have been applied yet**. This baseline records the exact state of the imported codebase, verifies development environment execution, and maps out the existing architecture.

---

## 2. Source Code Architecture & Tech Stack

| Layer                        | Technology                          | Version             | Role in Application                                                           |
| ---------------------------- | ----------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| **Language & Runtime**       | TypeScript / Node.js                | TS ^5.8.3 / Node 22 | Strict type safety across client, server functions, and tests                 |
| **UI Framework**             | React                               | ^19.2.0             | Next-generation React with concurrent features and server components          |
| **Full-Stack Routing & SSR** | TanStack Start & Router             | 1.168.60 / 1.170.41 | Full-stack SSR, file-based routing, server functions, type-safe routes        |
| **Bundler & Build Tool**     | Vite                                | 8.1.5               | Fast compilation, HMR (in standard environments), SSR bundling                |
| **Styling & Design Tokens**  | Tailwind CSS v4 + @tailwindcss/vite | ^4.2.1              | Deep-space aesthetic, CSS theme variables in `src/styles.css`                 |
| **Component Primitives**     | Radix UI + shadcn/ui pattern        | Diverse             | Unstyled, accessible UI components (dialog, sheet, dropdown, popover)         |
| **3D & Visualizations**      | Three.js                            | ^0.186.1            | Storefront interactive galaxy particle scene with dynamic import & SSR guards |
| **Motion & Animations**      | Motion (formerly Framer Motion)     | ^14.1.0             | Planetary opening hero, page transitions, accordion motion                    |
| **Data Layer & ORM**         | Drizzle ORM / Drizzle Kit           | ^0.45.3 / ^0.31.11  | Schema definitions and migration management                                   |
| **Backend & Auth**           | Supabase JS Client                  | ^2.117.2            | PostgreSQL queries, RPC calls, auth session management, storage downloads     |
| **HTML Parsing & Scraping**  | Cheerio                             | ^1.2.0              | Retailer page scraping (Amazon buy-box, Flipkart metadata, OG tags)           |
| **Testing**                  | Vitest + Testing Library            | ^4.1.10 / ^16.0.0   | Unit and integration testing with JSDOM environment                           |

---

## 3. Directory Layout & Key Modules

```
/
├── drizzle/                     # Database migrations (0000 - 0009) & Drizzle metadata
│   ├── migrations/              # SQL migration files executed sequentially
│   └── schema.ts                # Drizzle schema export
├── public/                      # Static assets (favicon, robots.txt)
├── src/
│   ├── assets/                  # High-resolution planet video/cutout metadata & nebula art
│   ├── components/
│   │   ├── admin/               # CategorySelect, DuplicateWarningDialog, ProductForm, Admin UI
│   │   ├── store/               # CelestialPlanet, GalaxyScene, PlanetHero, ProductCard, etc.
│   │   └── ui/                  # 35+ Radix/shadcn primitives (button, dialog, sonner, etc.)
│   ├── hooks/                   # use-mobile hook
│   ├── integrations/supabase/   # Supabase client (client.ts, client.server.ts, auth-middleware.ts)
│   ├── lib/                     # Core business logic:
│   │   ├── admin.ts             # Image validation and optimization pipeline
│   │   ├── admin-queries.ts     # Admin data queries with RLS
│   │   ├── celestial-catalog.ts # Astronomical system mapping for categories
│   │   ├── duplicate-detector.ts# Affiliate link deduplication
│   │   ├── retailer-price.ts    # Amazon and Flipkart price extraction
│   │   ├── retailer-currency.ts # Currency detection and formatting
│   │   └── store.ts             # Main storefront queries and intelligent search
│   ├── routes/                  # TanStack Router file-based route definitions
│   │   ├── _admin/              # Authenticated admin layout and subpages
│   │   ├── _store/              # Public storefront layout and buyer routes
│   │   ├── api/                 # Server endpoints (/api/public/img/$, /api/admin/*)
│   │   ├── __root.tsx           # Document root, SEO meta tags, font loading
│   │   └── router.tsx           # Router factory and dehydrated queryClient configuration
│   ├── server.ts                # Server entry point with SSR error recovery
│   ├── start.ts                 # TanStack Start instance with CSRF & auth middlewares
│   └── styles.css               # Design system variables, starfield, galaxy gradients
└── supabase/
    └── config.toml              # Supabase configuration (Project ID: qkmvundbkauaeqkmijeh)
```

---

## 4. Current State & Verification Status

- **Dev Server**: Running on port `3000` (host `0.0.0.0`), responding HTTP 200 to live requests.
- **Build**: Successfully compiles with `npm run build` (`compile_applet` passed).
- **Linter**: 0 errors across entire repository (`eslint .` passed).
- **Test Suite**: 9 test suites, 48 total tests executed via Vitest — **100% passing**.
- **Backend Status**: Default fallback targets a Lovable Cloud production Supabase instance (`c--e5dc52fc-4129-47cd-9ba2-1c20a9af2f78-prod.lovable.cloud`). All mutation commands must remain strictly isolated until dedicated development credentials are provided.
