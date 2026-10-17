# Phase 2 — Prompt 06: Multi-Tenant Authentication & Role-Based Authorization

## 1. Existing Admin Authentication Audit

Before implementing multi-tenant authorization, an in-depth audit of the existing Our Visible Universe administrative authentication architecture was performed:

### 1.1 Legacy Authentication Assumptions

1. **Single-Store Assumption**: The application historically assumed only one store existed ("Our Visible Universe"). Any authenticated user present in `public.admins` with a verified email was automatically granted global write access to **all** products, categories, site settings, and storage buckets.
2. **Global `is_admin()` RPC**: Database Row Level Security (RLS) policies evaluated `public.is_admin()`, which returned true if `auth.uid()` matched any record in `public.admins`. It had no concept of store boundaries (`store_id`).
3. **Hardcoded Fallbacks in UI**: `src/routes/admin.login.tsx` contained hardcoded email checks (`PRIMARY_ADMINS = ["mukul.srivastava.025@gmail.com", "mukul.sri.25@gmail.com"]`) as a setup fallback.
4. **Binary Role Model**: The system had only two roles: anonymous public visitor vs. full administrative superuser. There were no granular distinctions for store owners, category editors, or read-only team members.

---

## 2. Multi-Tenant Role Hierarchy & Permissions Matrix

The new multi-tenant architecture implements five distinct tiers with granular, capability-based permissions:

```
┌────────────────────────────────────────────────────────┐
│               PLATFORM SUPER ADMINISTRATOR             │
│   (Global tenant lifecycle, operator overrides)        │
└───────────────────────────┬────────────────────────────┘
                            │
             ┌──────────────┴──────────────┐
             ▼                             ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│       STORE OWNER         │ │       STORE OWNER         │
│ (Settings, team, billing) │ │ (Settings, team, billing) │
├───────────────────────────┤ ├───────────────────────────┤
│       STORE ADMIN         │ │       STORE ADMIN         │
│   (Products, categories)  │ │   (Products, categories)  │
├───────────────────────────┤ ├───────────────────────────┤
│       STORE EDITOR        │ │       STORE EDITOR        │
│   (Drafts, content edits) │ │   (Drafts, content edits) │
├───────────────────────────┤ ├───────────────────────────┤
│       STORE VIEWER        │ │       STORE VIEWER        │
│  (Read-only team member)  │ │  (Read-only team member)  │
└─────────────┬─────────────┘ └─────────────┬─────────────┘
              ▼                             ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│      PUBLIC VISITOR       │ │      PUBLIC VISITOR       │
│  (Active storefront read) │ │  (Active storefront read) │
└───────────────────────────┘ └───────────────────────────┘
```

### Granular Capability Matrix

| Permission                 | Platform Super Admin | Store Owner | Store Admin | Store Editor | Store Viewer | Public Visitor |
| -------------------------- | :------------------: | :---------: | :---------: | :----------: | :----------: | :------------: |
| `store:view`               |          ✅          |     ✅      |     ✅      |      ✅      |      ✅      |       ❌       |
| `store:update`             |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |
| `store:archive`            |          ✅          |     ✅      |     ❌      |      ❌      |      ❌      |       ❌       |
| `store:billing`            |          ✅          |     ✅      |     ❌      |      ❌      |      ❌      |       ❌       |
| `store:transfer_ownership` |          ✅          |     ✅      |     ❌      |      ❌      |      ❌      |       ❌       |
| `members:list`             |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |
| `members:invite`           |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |
| `members:update_role`      |          ✅          |     ✅      |     ❌      |      ❌      |      ❌      |       ❌       |
| `members:remove`           |          ✅          |     ✅      |     ❌      |      ❌      |      ❌      |       ❌       |
| `invitations:revoke`       |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |
| `domains:view`             |          ✅          |     ✅      |     ✅      |      ✅      |      ✅      |       ❌       |
| `domains:manage`           |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |
| `products:view`            |          ✅          |     ✅      |     ✅      |      ✅      |      ✅      |       ❌       |
| `products:create`          |          ✅          |     ✅      |     ✅      |      ✅      |      ❌      |       ❌       |
| `products:edit`            |          ✅          |     ✅      |     ✅      | ✅ (Drafts)  |      ❌      |       ❌       |
| `products:publish`         |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |
| `products:delete`          |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |
| `categories:manage`        |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |
| `collections:manage`       |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |
| `designs:view`             |          ✅          |     ✅      |     ✅      |      ✅      |      ✅      |       ❌       |
| `designs:edit`             |          ✅          |     ✅      |     ✅      |      ✅      |      ❌      |       ❌       |
| `designs:publish`          |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |
| `analytics:view`           |          ✅          |     ✅      |     ✅      |      ❌      |      ❌      |       ❌       |

---

## 3. Server-Side Authorization Flow

All authorization checks are performed server-side and never trust client-submitted user IDs, roles, or raw URL store parameters:

```
                   Incoming Client Request
                              │
                              ▼
           ┌──────────────────────────────────────┐
           │     resolveAuthenticatedUser()       │
           │  (Extract verified Supabase token)   │
           └──────────────────┬───────────────────┘
                              │
                              ▼
           ┌──────────────────────────────────────┐
           │      checkPlatformSuperAdmin()       │
           └──────────────────┬───────────────────┘
                   /                      \
          (Yes)   /                        \  (No)
                 ▼                          ▼
      ┌──────────────────────┐    ┌──────────────────────────────────┐
      │  Bypass store checks │    │     getStoreMembership()         │
      │  Full Owner rights   │    │  (store_id + user_id + status)   │
      └──────────────────────┘    └─────────────────┬────────────────┘
                                                    │
                                                    ▼
                                  ┌──────────────────────────────────┐
                                  │      Status == 'active'?         │
                                  └─────────────────┬────────────────┘
                                          /                   \
                                 (Yes)   /                     \  (No / Suspended)
                                        ▼                       ▼
                           ┌────────────────────────┐  ┌──────────────────┐
                           │ hasStorePermission()?  │  │  Throw Error     │
                           └────────────┬───────────┘  │ (403 Forbidden)  │
                                        │              └──────────────────┘
                               ┌────────┴────────┐
                        (Yes)  ▼                 ▼  (No)
                      ┌───────────────┐   ┌───────────────────────┐
                      │ Proceed with  │   │  Throw Error          │
                      │   Operation   │   │ (MISSING_PERMISSION)  │
                      └───────────────┘   └───────────────────────┘
```

---

## 4. Membership & Invitation Lifecycle

### 4.1 Secure Invitation Generation

- **Token Generation**: Uses Web Crypto API `crypto.randomUUID()` to produce unguessable 128-bit entropy tokens.
- **Expiration**: Standard 7-day TTL (`created_at + 7 days`).
- **Target Role Bounds**: Only `admin`, `editor`, or `viewer` can be invited. Owner role cannot be granted via standard invitation.
- **Store Binding**: Bound to a specific `store_id`.

### 4.2 Single-Use & Email Identity Redemption

- **Single-Use Defense**: Once accepted, `accepted_at` is set or the record is consumed. Attempted re-use throws `ALREADY_ACCEPTED`.
- **Identity Binding**: The authenticated user's confirmed email must match the invitation recipient email (case-insensitive). If an imposter attempts to claim the token, it is rejected with `IDENTITY_MISMATCH`.
- **Expiration Defense**: Expired tokens are rejected with `INVITATION_EXPIRED`.

### 4.3 Last-Owner & Ownership Protection

- **Last-Owner Guard**: Store owners cannot be removed if they are the sole owner of the store. Ownership must first be transferred to an active administrator.
- **Unilateral Exit Guard**: Store owners cannot leave a store without transferring ownership.
- **Privilege Escalation Guard**: Editors and viewers cannot modify member roles or promote anyone to admin. Admins cannot promote anyone to owner.

---

## 5. Tenant-Aware Context Switching

When an administrator manages multiple stores:

- **Switching Enforcement**: The server validates that the authenticated user holds an active membership in the target store before switching.
- **Context Isolation**: All active permissions and roles are rebuilt strictly from the target store's membership record. Privileges from Store A never leak into Store B.
- **Rejection of Unauthorized Targets**: Attempting to switch to an unassigned store ID is immediately rejected with `FORBIDDEN`.

---

## 6. Legacy Store Compatibility

- **Tenant 0 Mapping**: Approved administrators from the legacy `public.admins` table are mapped to Tenant 0 (`00000000-0000-0000-0000-000000000001`).
- **Preserved Existing Routes**: Legacy admin routes continue functioning via `isLegacyAdmin()` compatibility bridges.
- **Strict Tenant Containment**: Legacy administrators are **not** granted platform super admin rights and cannot administer newly provisioned customer stores.

---

## 7. Security Test Results

All automated security tests in `src/test/multi-tenant-auth.test.ts` pass with 100% success rate:

- ✅ Owner accessing own store: **Allowed**
- ✅ Owner denied access to another store: **Blocked** (`AuthorizationError`)
- ✅ Admin accessing permitted operations: **Allowed**
- ✅ Editor blocked from privileged operations (billing, archive, delete): **Blocked** (`MISSING_PERMISSION`)
- ✅ Public visitor blocked from admin operations: **Blocked** (`MEMBERSHIP_NOT_FOUND`)
- ✅ Suspended member blocked: **Blocked** (`MEMBERSHIP_SUSPENDED`)
- ✅ Cryptographically secure invitation creation: **Verified**
- ✅ Single-use invitation redemption: **Verified**
- ✅ Email identity mismatch rejection: **Verified** (`IDENTITY_MISMATCH`)
- ✅ Expired invitation rejection: **Verified** (`INVITATION_EXPIRED`)
- ✅ Last-owner removal defense: **Verified** (`LAST_OWNER_PROTECTION`)
- ✅ Unilateral store exit protection for owners: **Verified** (`OWNER_CANNOT_LEAVE`)
- ✅ Unauthorized role escalation defense: **Verified** (`UNAUTHORIZED_ESCALATION`)
- ✅ Tenant-aware context switching without permission leakage: **Verified**
- ✅ Platform super admin global override: **Verified**
- ✅ Legacy admin containment to Tenant 0: **Verified**

---

## 8. Unresolved Risks & Next Steps (Prompt 07)

- **Database Session Tokens**: In production, Supabase Auth tokens are signed JWTs. When custom claim hooks are enabled in Supabase, store roles can be cached in claims with a refresh trigger on role mutation.
- **Next Prompt (Prompt 07)**: Multi-Tenant Storefront and Admin Routing Architecture — URL subdomain mapping, custom domain routing middleware, and tenant-scoped admin layout switching.
