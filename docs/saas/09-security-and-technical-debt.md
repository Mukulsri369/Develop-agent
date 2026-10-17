# 09 — Security Vulnerabilities & Technical Debt Audit

This document details all security vulnerabilities, authorization gaps, architectural risks, and technical debt discovered during the Prompt 02 codebase audit.

---

## 1. Security Vulnerabilities & Authorization Gaps

### VULN-01: Server-Side Request Forgery (SSRF) & Unrestricted URL Ingestion

- **Severity**: **HIGH**
- **Affected Files**:
  - `src/routes/api/admin/scrape-product.ts` (lines 171–205)
  - `src/routes/api/admin/check-price.ts` (lines 77–128)
- **Risk Analysis**:
  - Both endpoints accept an arbitrary `url` in the JSON POST body and execute a server-side `fetch(parsedUrl.toString())` with redirect-following (`redirect: "follow"`).
  - Although `try { parsedUrl = new URL(...) }` is performed, there is **no validation restricting destination hostnames, schemes, or IP addresses**.
  - A malicious user could supply `http://127.0.0.1:3000/`, `http://localhost:*`, or cloud instance metadata endpoints (e.g. `http://169.254.169.254/computeMetadata/v1/`), potentially exposing internal server information or reaching internal network resources.
- **Remediation**:
  1. Restrict URL protocol strictly to `https:`.
  2. Validate hostnames against an allowlist of supported retailers (`*.amazon.*`, `*.amzn.to`, `*.flipkart.com`, `*.ubuy.*`) or resolve DNS to ensure target IPs do not fall within private IPv4/IPv6 ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`).
  3. Enforce an authentication barrier before processing any URL.

---

### VULN-02: Missing Server-Side Authentication on Admin API Routes

- **Severity**: **HIGH**
- **Affected Files**:
  - `src/routes/api/admin/scrape-product.ts`
  - `src/routes/api/admin/check-price.ts`
- **Risk Analysis**:
  - In TanStack Start, file-based routes under `src/routes/api/admin/*` define raw server handlers via `createFileRoute("/api/admin/scrape-product")({ server: { handlers: { POST: ... } } })`.
  - While client-side admin pages (`src/routes/_admin.tsx`) are protected by a `beforeLoad` auth check, **the `/api/admin/*` HTTP endpoints do not execute auth middleware or verify admin JWT tokens**.
  - Any external client can send unauthenticated POST requests directly to `/api/admin/scrape-product` to scrape URLs or consume server bandwidth.
- **Remediation**:
  1. Integrate Supabase auth verification in all `/api/admin/*` server handlers:
     ```typescript
     const {
       data: { user },
       error,
     } = await supabase.auth.getUser(bearerToken);
     if (error || !user) return new Response("Unauthorized", { status: 401 });
     ```
  2. Call `public.is_admin()` or the new `is_tenant_admin(tenant_id)` RPC to verify administrative privileges before executing the scrape or price check.

---

### VULN-03: Production Credentials in Default Source Code Fallbacks

- **Severity**: **MEDIUM**
- **Affected Files**:
  - `src/integrations/supabase/client.ts` (lines 33–34)
  - `src/integrations/supabase/auth-middleware.ts` (lines 39–43)
  - `supabase/config.toml` (line 1)
- **Risk Analysis**:
  - The codebase hardcodes fallback credentials pointing to `https://c--e5dc52fc-4129-47cd-9ba2-1c20a9af2f78-prod.lovable.cloud` and public key `sb_publishable_LnvKmEnYxmXbvplWO-pkgw_6cxxCkYL`.
  - While publishable keys are public by design, falling back to production credentials in development runs the risk of developers or automated scripts accidentally reading from or mutating the production database if environment variables are unset.
- **Remediation**:
  1. Remove hardcoded production URL fallbacks when transitioning to multi-tenant dev mode.
  2. Require explicit `.env` configurations in non-production environments with fallback to mock or local database instances.

---

### VULN-04: Hardcoded Global Admin Emails in Source & Database Seeding

- **Severity**: **MEDIUM**
- **Affected Files**:
  - `src/routes/_admin.admin.settings.tsx` (lines 52–53: `DEFAULT_ADMINS = ["mukul.srivastava.025@gmail.com", ...]`)
  - `drizzle/migrations/0000_migration.sql` (line 9: `INSERT INTO public.admins (email) VALUES ('mukul.srivastava.025@gmail.com')`)
- **Risk Analysis**:
  - Administrative authority is tied to specific hardcoded email addresses in source code and database migrations.
  - In a SaaS platform where external customers sign up to create their own stores, hardcoded administrator emails must be replaced with dynamic role-based access control (RBAC).
- **Remediation**:
  - Introduce `public.tenants` and `public.tenant_members` tables. Store creators become the `owner` of their specific tenant without any global email allowlist.

---

## 2. Multi-Tenant Architectural Constraints & Debt

### DEBT-01: Global Slug Uniqueness on Products and Categories

- **Severity**: **HIGH** (Architectural Blocker)
- **Affected Files**:
  - `drizzle/migrations/0000_migration.sql` (lines 29, 62)
  - `src/lib/store.ts`
- **Issue**:
  - `categories.slug` and `products.slug` are marked `UNIQUE` across the entire database.
  - In a multi-tenant platform, multiple independent stores will legitimately have products named "Black T-Shirt" (`black-t-shirt`) or categories named "Accessories" (`accessories`).
- **Remediation**:
  - Change constraints from global `UNIQUE(slug)` to compound unique indexes: `UNIQUE(tenant_id, slug)`.

---

### DEBT-02: Global Uniqueness Trigger on Affiliate URLs

- **Severity**: **HIGH** (Architectural Blocker)
- **Affected Files**:
  - `drizzle/migrations/0007_prevent_duplicate_affiliate_publishing.sql`
- **Issue**:
  - Trigger `prevent_duplicate_affiliate_publishing` checks whether any product in the entire `public.products` table already uses the specified affiliate link.
  - In a multi-tenant platform, two different affiliate store owners may want to feature the same popular Amazon product with their own tags.
- **Remediation**:
  - Scope the duplicate query to the current tenant:
    ```sql
    WHERE p.id IS DISTINCT FROM NEW.id
      AND p.tenant_id = NEW.tenant_id
      AND ...
    ```

---

### DEBT-03: Singleton `site_settings` Table

- **Severity**: **HIGH** (Architectural Blocker)
- **Affected Files**:
  - `drizzle/migrations/0000_migration.sql` (lines 139–158)
  - `drizzle/migrations/0002_protect_private_store_contact_settings.sql`
  - `src/lib/store.ts` (`settingsQuery` queries `id = 1`)
- **Issue**:
  - The table enforces `id int PRIMARY KEY DEFAULT 1 CHECK (id = 1)`.
  - Only one store's name, logo, social links, and contact info can be stored.
- **Remediation**:
  - Alter `site_settings` to reference `tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE`.

---

### DEBT-04: Deprecated Legacy Amazon Columns

- **Severity**: **LOW**
- **Affected Files**:
  - `drizzle/migrations/0005_generalize_product_affiliate_links.sql`
  - `src/lib/store.ts`
  - `src/components/admin/ProductForm.tsx`
- **Issue**:
  - The schema retains `amazon_url`, `amazon_asin`, and `amazon_marketplace` alongside `affiliate_url`, `retailer`, and `retailer_product_id`.
  - Dual-column reading exists in storefront queries (`p.affiliate_url || p.amazon_url`) for backwards compatibility.
- **Remediation**:
  - Maintain the fallback reading in `src/lib/store.ts` to preserve Tenant 0 integrity, but ensure all newly created products write exclusively to `affiliate_url` and `retailer`.
