# 04 — Development Safety Rules & Guardrails

## 1. Safety Directives & Protocol

To safeguard the live Our Visible Universe Store production environment while building the multi-tenant SaaS architecture, all development must adhere to the following rules:

### Rule 1: Local / Sandbox Isolation

- All development and experimentation must occur strictly inside this isolated AI Studio container.
- Never trigger push or publish actions to the upstream GitHub repository (`Mukulsri369/ourvisibleuniversestore`) or its production branch.

### Rule 2: Production Database Protection

- **Zero Live Mutations**: No `INSERT`, `UPDATE`, `DELETE`, or `ALTER TABLE` operations may be executed against the default production Lovable Cloud database (`c--e5dc52fc-4129-47cd-9ba2-1c20a9af2f78-prod.lovable.cloud`).
- **No Migration Deployment to Prod**: Migration scripts in `drizzle/migrations/` must never be run against production credentials.
- **Read-Only Verification**: Any interactions with the current database defaults must remain strictly read-only for schema inspection and local query testing.

### Rule 3: Preserving the Source Application

- Do not discard, replace, or hollow out the existing storefront.
- When multi-tenancy is introduced in subsequent prompts, the original Our Visible Universe storefront will serve as the premier flagship tenant ("Tenant 0" / Reference Store) or default storefront template.
- All existing components, utility functions, celestial graphics, and admin panels must remain intact and functional.

### Rule 4: Credential & Secret Management

- Never hardcode API keys, service role tokens, or private certificates in client code or Git-tracked files.
- Place all environment variables in `.env` (gitignored) and document keys in `.env.example`.
- Server-side credentials (like `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY`) must never be referenced with `VITE_` prefixes or imported into client components.

### Rule 5: Step-by-Step Architecture Progression

- **Prompt 01 (Current)**: Baseline verification, documentation, hygiene, test passing. **STOP HERE**.
- **Prompt 02 (Next)**: Multi-tenant data model design and tenant isolation strategies (requiring dedicated dev database or mock tenant layers).
- **Subsequent Prompts**: Natural language store generation, dynamic theming, and multi-tenant admin dashboards.

---

## 2. Blocked Operations (Pending Isolated Staging Database)

The following actions are **BLOCKED** until a verified development or staging Supabase project is configured via `.env`:

1. Applying new database migrations (e.g., adding `tenant_id` columns, tenant tables).
2. Creating test user accounts via `supabase.auth.signUp()`.
3. Executing automated write tests against live endpoints.
4. Uploading dummy test images to the production `store-images` storage bucket.
