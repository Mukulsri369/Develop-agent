# 17 — Implementation Dependency Map & Execution Sequence

## 1. Implementation Phasing & Dependency Graph

```
                                  PROMPT 01 & 02 [COMPLETED]
                        Baseline Verification & Codebase Audit
                                             │
                                             ▼
                                     PROMPT 03 [CURRENT]
                           Master SaaS Architecture & Blueprint
                                             │
                                             ▼
                                         PHASE 2
               ┌─────────────────────────────────────────────────────────┐
               │    PROMPT 04: MULTI-TENANT FOUNDATION & SECURITY        │
               │    - Dev database provisioning                          │
               │    - Multi-tenant additive migration execution          │
               │    - Tenant 0 backfill & scoping                        │
               │    - SSRF & API route auth hardening                    │
               └─────────────────────────────┬───────────────────────────┘
                                             │
                                             ▼
                                         PHASE 3
               ┌─────────────────────────────────────────────────────────┐
               │    PROMPT 05: UNIVERSAL STOREFRONT ENGINE & REGISTRY    │
               │    - Universal Storefront Spec Zod schema implementation│
               │    - Dynamic theme token injector (CSS variables)       │
               │    - Component Registry (Heroes, Bentos, Rails, Footers)│
               │    - Tenant 0 spec extraction                           │
               └─────────────────────────────┬───────────────────────────┘
                                             │
                                             ▼
                                         PHASE 4
               ┌─────────────────────────────────────────────────────────┐
               │    PROMPT 06: AI DESIGN ENGINE & CONVERSATIONAL EDITOR  │
               │    - Gemini-2.5 server-side integration via @google/genai│
               │    - Structured JSON specification generation           │
               │    - Section-by-section diff & regeneration engine      │
               │    - Live iframe preview & version rollback             │
               └─────────────────────────────┬───────────────────────────┘
                                             │
                                             ▼
                                         PHASE 5
               ┌─────────────────────────────────────────────────────────┐
               │    PROMPT 07: MULTI-TENANT ADMIN & WORKSPACE PORTAL     │
               │    - Store switcher UI & team invitations               │
               │    - Tenant-scoped product CRUD & affiliate management  │
               │    - Subdomain routing & custom domain verification     │
               └─────────────────────────────────────────────────────────┘
```

---

## 2. Risk & Trade-off Matrix

| Decision / Strategy              | Trade-off Made                                                                                                            | Alternative Rejected                                                      | Risk Mitigation                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Shared Multi-Tenant Database** | High code efficiency & lower infrastructure cost, but requires rigorous Row Level Security.                               | Database-per-tenant (Spinning up a separate Postgres instance per store). | Database-enforced RLS policies with pinned `search_path = public`; unit tests asserting tenant query isolation.      |
| **Declarative JSON Design Spec** | Constrains AI generation to registered components, but guarantees 100% runtime stability and zero arbitrary JS injection. | Arbitrary React Code Generation (AI writes JSX/CSS on the fly).           | Component Registry offers extensive layout variants, color palettes, and typography choices for high visual variety. |
| **Additive Schema Migration**    | Keeps legacy columns (`amazon_url`, `site_settings` single row) temporarily readable during cutover.                      | Big-bang destructive schema rewrite.                                      | Zero downtime for the live Our Visible Universe flagship store; fallback reads in `src/lib/store.ts`.                |
| **Zero-Deploy Host Routing**     | All stores served dynamically from single full-stack runtime; no per-store deployments.                                   | Independent container deployment per customer.                            | Dynamic DNS resolution with in-memory caching of store specs for < 5ms response times.                               |

---

## 3. Exact Requirements & Prerequisites for Prompt 04

Before Prompt 04 initiates code changes, the following prerequisites are established:

1. **Isolated Database Environment**:
   - Staging/development database connection variables must be provided in `.env` (or a simulated schema runner must be used) to avoid modifying the live production database.
2. **Execution Scope for Prompt 04**:
   - Implement the `stores`, `store_members`, and tenant-scoped schema modifications.
   - Attach `store_id` foreign keys to `products`, `categories`, and `outbound_clicks`.
   - Update `prevent_duplicate_affiliate_publishing` trigger to be store-scoped.
   - Harden `/api/admin/scrape-product` and `/api/admin/check-price` with session auth verification and SSRF hostname allowlists.
   - Verify that all 48 existing Vitest unit tests continue passing 100%.
