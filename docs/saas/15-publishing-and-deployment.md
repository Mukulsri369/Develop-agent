# 15 — Publishing, Domain Management & Edge Deployment

## 1. Zero-Deployment Multi-Tenant Architecture

A foundational requirement of the platform is that **publishing a store or modifying a design never triggers a new code deployment or container build**.

A single globally deployed instance of the TanStack Start application dynamically resolves the incoming HTTP request's `Host` header, loads the active tenant's published design specification from PostgreSQL or edge cache, and renders the requested storefront in real time.

```
                    Incoming HTTP Request
                    (e.g. Host: aura.platform.com or Host: shop.brand.com)
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │ TanStack Start Server Engine │ (src/server.ts)
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │  Host Header Tenant Resolver │ (resolveTenantByHost)
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
   [Platform Subdomain]                         [Verified Custom Domain]
   e.g. *.platform.com                          e.g. shop.brand.com
   Match `stores.slug`                          Match `store_domains.domain`
              │                                         │
              └────────────────────┬────────────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  Tenant Cache (In-Memory/KV) │
                    └──────────────┬───────────────┘
                                   │ (Cache Hit: < 5ms)
                                   ▼
                    ┌──────────────────────────────┐
                    │  Universal Storefront Engine │
                    │   - Injects Theme CSS Tokens │
                    │   - Renders Section Registry │
                    │   - Injects Structured SEO   │
                    └──────────────────────────────┘
```

---

## 2. Tenant Resolution Lifecycle (`src/lib/tenant/resolver.ts`)

```typescript
export interface ResolvedTenant {
  storeId: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "archived" | "draft";
  publishedSpec: UniversalStorefrontSpec;
  isCustomDomain: boolean;
}

export async function resolveTenantByHost(hostHeader: string): Promise<ResolvedTenant | null> {
  const host = hostHeader.split(":")[0].toLowerCase();
  const rootDomain = process.env.PLATFORM_ROOT_DOMAIN || "platform.com";

  let query;
  if (host.endsWith(rootDomain)) {
    // 1. Subdomain Resolution: [subdomain].platform.com
    const subdomain = host.replace(`.${rootDomain}`, "").trim();
    if (!subdomain || subdomain === "www" || subdomain === "app") return null; // Reserved platform routes

    query = supabaseAdmin
      .from("stores")
      .select(
        "id, slug, name, status, store_designs!inner(published_version_id, store_design_versions!published_version_id(spec))",
      )
      .eq("slug", subdomain)
      .maybeSingle();
  } else {
    // 2. Custom Domain Resolution: shop.brand.com
    query = supabaseAdmin
      .from("store_domains")
      .select(
        "store_id, stores!inner(id, slug, name, status, store_designs!inner(published_version_id, store_design_versions!published_version_id(spec)))",
      )
      .eq("domain", host)
      .eq("status", "verified")
      .maybeSingle();
  }

  const { data, error } = await query;
  if (error || !data) return null;

  // Extract resolved store data and published design specification
  return formatTenantResponse(data);
}
```

---

## 3. Custom Domain Verification & SSL Architecture

1. **DNS CNAME Target**: Store owners point their domain (`shop.mybrand.com`) to `cname.platform.com`.
2. **Domain Ownership Verification**:
   - The platform generates a random verification token: `ovu-verify={uuid}`.
   - The store owner adds a DNS `TXT` record at `_ovu-challenge.shop.mybrand.com`.
   - The admin UI provides a "Verify DNS" button calling `dns.promises.resolveTxt`.
   - Once verified, the record in `public.store_domains` changes from `pending` to `verified`.
3. **Automated SSL Provisioning**:
   - Cloudflare for SaaS or reverse-proxy edge automatically terminates TLS using wildcard and custom-hostname SNI certificates.

---

## 4. Draft vs. Published State Isolation

To prevent experimental AI generations from breaking live traffic:

1. **Draft State (`public.store_designs.draft_spec`)**:
   - When a creator prompts Gemini, edits copy, or switches colors, changes write strictly to `draft_spec`.
   - The Live Preview in the admin console reads `draft_spec` inside a sandboxed iframe with token authentication (`/_preview/:storeId`).
2. **Published State (`public.store_design_versions`)**:
   - Clicking **"Publish Store"** creates an immutable record in `store_design_versions`, assigns a new version number (e.g., v3), and updates `store_designs.published_version_id`.
   - Public visitors only ever see the design attached to `published_version_id`.
3. **Instant Rollback**:
   - If an owner wants to revert to last week's design, they select v2 from history. The server sets `published_version_id = v2_id`, instantly reverting public rendering in 0 milliseconds.

---

## 5. Dynamic SEO & Per-Store Sitemaps

Each tenant storefront receives dedicated, dynamic search engine optimization:

1. **Metadata Injection (`src/routes/__root.tsx`)**:
   - Title: `spec.seo.titleTemplate.replace("%s", pageTitle)`
   - Description: `spec.seo.metaDescription`
   - OpenGraph & Twitter Cards: Dynamically configured with `spec.seo.ogImage` and the store's primary accent color.
   - Structured JSON-LD: Automated `Schema.org/Store` and `Schema.org/Product` output.
2. **Per-Tenant `/sitemap.xml`**:
   - Server route `/sitemap.xml` inspects the active `Host`, queries all live products for that specific store (`store_id`), and outputs XML with canonical URLs pointing to the store's primary domain.
3. **Store Suspension**:
   - If a store is marked `status = 'suspended'` (e.g. terms violation or expired trial), the server returns HTTP 503 with a clean "Store Temporarily Inactive" page, blocking product listings and affiliate links.
