# 19 — Storefront Module Boundaries & Layer Separation

## 1. Module Boundary Architecture

The Prompt 04 refactoring establishes distinct, decoupled layers across the application:

```
┌────────────────────────────────────────────────────────┐
│                   ROUTES LAYER (Vite)                  │
│       src/routes/_store.*  │  src/routes/_admin.*      │
└───────────────────────────┬────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌───────────────────────┐       ┌───────────────────────┐
│     COMMERCE LAYER    │       │    STOREFRONT LAYER   │
│  src/commerce/types   │       │  src/storefront/      │
│  src/commerce/normal  │       │  ├── design/ (Zod)    │
│  src/lib/store.ts     │       │  ├── registry/ (UI)   │
│  src/lib/retailer-*   │       │  ├── animations/      │
└───────────┬───────────┘       │  └── themes/astronomy/│
            │                   └───────────┬───────────┘
            │                               │
            └───────────────┬───────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│                     PLATFORM LAYER                     │
│    src/platform/context.ts  │  src/platform/identity.ts│
└────────────────────────────────────────────────────────┘
```

---

## 2. Layer Responsibilities & Contracts

### A. Platform Layer (`src/platform/`)

- **Scope**: Platform-level identity, tenant context interfaces, and default branding configurations.
- **Rules**: Must never import presentation components directly. Provides raw configuration objects to be consumed by storefront and admin chrome.

### B. Storefront Layer (`src/storefront/`)

- **Scope**:
  - `design/`: Universal Storefront Specification Zod schemas and CSS variable generator.
  - `registry/`: Registry mapping approved section types to React component implementations with fallback protection.
  - `animations/`: Reusable Motion presets and Three.js canvas lifecycle hooks.
  - `themes/astronomy/`: Explicit boundary housing all original Our Visible Universe space assets and visual components.
- **Rules**: Presentation logic consumes normalized commerce types. Never writes raw database queries.

### C. Commerce Layer (`src/commerce/` & `src/lib/`)

- **Scope**: Product catalog retrieval, category matching, relevance search, affiliate price parsing, and currency formatting.
- **Rules**: Agnostic of visual layout. Prepares structured data arrays for consumer components.

### D. Routes Layer (`src/routes/`)

- **Scope**: TanStack Start file-based route definitions and SSR entry points.
- **Rules**: Coordinates data prefetching (`loader`), binds route params, and invokes layout chrome.
