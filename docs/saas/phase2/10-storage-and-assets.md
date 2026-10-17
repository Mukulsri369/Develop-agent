# Phase 2 — Prompt 10: Multi-Tenant Media Storage, Asset Ownership and File Security

## 1. Executive Summary

This phase upgrades the storage subsystem from a single-store image bucket with flat directory paths into a multi-tenant media storage architecture with strict store-level asset ownership, object-level security policies, untrusted input sanitation, and audit-ready asset metadata (`public.store_assets`).

### Key Accomplishments:

1. **Tenant-Partitioned Object Hierarchy**: Implemented structured pathing `stores/{store_id}/{asset_type}/{asset_id}.{extension}` ensuring predictable, collision-free object naming.
2. **Storage RLS & Security Definer Resolution**: Storage policies on `storage.objects` use `public.extract_storage_store_id(path)` to verify store membership (`is_store_editor` for uploads/updates, `is_store_admin` for deletions).
3. **Asset Metadata Tracking (`public.store_assets`)**: Introduced full asset tracking for store ownership, file size, MIME type, dimensions, visibility, AI generation provenance, and usage references.
4. **Public Delivery Route Hardening (`/api/public/img/$`)**: Validates tenant and legacy paths, strictly denies path traversal (`..`), and blocks public access to confidential documents (`documents/`).
5. **Untrusted Input Sanitation & Script Execution Prevention**: File format validation supports JPEG, PNG, WebP, and AVIF while rejecting SVG, HTML, scripts, and executable payloads.
6. **Legacy Compatibility Preservation**: Existing single-tenant object paths (`products/...`, `categories/...`, `branding/...`) continue resolving to Tenant 0 ("Our Visible Universe") without data migration.
7. **Storage Quotas and Usage Tracking**: Added `public.store_storage_usage` view and `StoreAssetService.getStoreUsage` to measure storage consumption and quota limits.

---

## 2. Bucket Structure & Object Path Conventions

### Bucket Definition

- **Bucket**: `store-images` (private Supabase Storage bucket with authenticated access policies and controlled public delivery).

### Modern Path Specification

```
stores/{store_id}/{asset_type}/{asset_id}.{extension}
```

| Segment        | Validation Rule                                                              | Example                                | Purpose                             |
| :------------- | :--------------------------------------------------------------------------- | :------------------------------------- | :---------------------------------- |
| `stores/`      | Fixed literal prefix                                                         | `stores/`                              | Namespace partition                 |
| `{store_id}`   | UUID v4 matching `public.stores(id)`                                         | `11111111-1111-1111-1111-111111111111` | Tenant owner identifier             |
| `{asset_type}` | Strict enum (`products`, `categories`, `branding`, `generated`, `documents`) | `products`                             | Security classification & lifecycle |
| `{asset_id}`   | Cryptographic UUID v4                                                        | `9f3c72b2-601e-4cb8-8c10-909249787e91` | Non-colliding asset key             |
| `.{extension}` | Allowed: `webp`, `avif`, `jpg`, `png`                                        | `.webp`                                | Re-encoded media extension          |

### Legacy Path Compatibility

- `products/{uuid}.{ext}` → Evaluated as belonging to Tenant 0 (`00000000-0000-0000-0000-000000000001`).
- `categories/{uuid}.{ext}` → Evaluated as belonging to Tenant 0.
- `branding/{uuid}.{ext}` → Evaluated as belonging to Tenant 0.

---

## 3. Asset Metadata Schema (`public.store_assets`)

```sql
CREATE TABLE public.store_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  bucket_id text NOT NULL DEFAULT 'store-images',
  storage_path text NOT NULL UNIQUE,
  asset_type text NOT NULL CHECK (asset_type IN ('products', 'categories', 'branding', 'generated', 'documents')),
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL DEFAULT 0,
  width int,
  height int,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'unlisted')),
  checksum_sha256 text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_ai_generated boolean NOT NULL DEFAULT false,
  ai_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  usage_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 4. Storage Row-Level Security Matrix

| Action     | Target Object                             | Actor                | RLS Evaluation Rule                              | Result                     |
| :--------- | :---------------------------------------- | :------------------- | :----------------------------------------------- | :------------------------- |
| **SELECT** | Public asset (`products/*`, `branding/*`) | Anyone (Anon/Auth)   | `store_is_active(store_id)` AND NOT `documents/` | **ALLOWED**                |
| **SELECT** | Private asset (`documents/*`)             | Anonymous Visitor    | `is_store_member(store_id)`                      | **BLOCKED (403)**          |
| **SELECT** | Private asset (`documents/*`)             | Store Member         | `is_store_member(store_id)`                      | **ALLOWED**                |
| **INSERT** | `stores/{storeA}/*`                       | Store A Editor/Admin | `is_store_editor(storeA)`                        | **ALLOWED**                |
| **INSERT** | `stores/{storeB}/*`                       | Store A Admin        | `is_store_editor(storeB)`                        | **BLOCKED (Cross-Tenant)** |
| **UPDATE** | `stores/{storeA}/*`                       | Store A Editor/Admin | `is_store_editor(storeA)`                        | **ALLOWED**                |
| **DELETE** | `stores/{storeA}/*`                       | Store A Admin/Owner  | `is_store_admin(storeA)`                         | **ALLOWED**                |
| **DELETE** | `stores/{storeB}/*`                       | Store A Admin        | `is_store_admin(storeB)`                         | **BLOCKED (Cross-Tenant)** |

---

## 5. Media Processing & Delivery Protection

### Upload & Validation Flow

1. **Client Optimization & Formatting**:
   - `validateMediaUpload` verifies MIME type against `image/jpeg`, `image/png`, `image/webp`, and `image/avif`.
   - Hard size limit enforced (10 MB).
   - SVG, HTML, JS, PHP, and executable payloads are rejected immediately to prevent script execution vulnerabilities.
   - Images are scaled to max 1600px width/height and re-encoded to WebP/AVIF via canvas rendering when supported.
2. **Path Construction**:
   - `buildTenantStoragePath(storeId, folder, ext)` computes deterministic UUID path. User-submitted file names are never used for filesystem paths.
3. **Storage & Metadata Persistence**:
   - Uploaded with `upsert: false` to guarantee that concurrent uploads cannot overwrite existing assets.
   - Inserted into `public.store_assets` with visibility, size, and store association.

### Public Delivery Route (`/api/public/img/$`)

- Validates the splat parameter against `TENANT_PUBLIC_PATH_REGEX` and `LEGACY_PUBLIC_PATH_REGEX`.
- Strictly rejects any path containing `..`, `\`, null bytes, or `//`.
- Blocks any attempt to access `documents/` or private administrative paths through the public endpoint.
- Emits security headers:
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy: default-src 'none'; sandbox`
  - `Cache-Control: public, max-age=31536000, immutable`

---

## 6. Legacy Media Compatibility Strategy

1. **Path Continuity**: Original astronomy store images in `products/...`, `categories/...`, and `branding/...` remain in place and continue loading directly without broken links.
2. **Backward-Compatible Resolution**: `parseStoragePath` and `extract_storage_store_id` recognize legacy single-tenant paths as belonging to Tenant 0 (`00000000-0000-0000-0000-000000000001`).
3. **Zero Production Risk**: No production file migration or deletion is executed; all new uploads adopt the `stores/{store_id}/...` standard.

---

## 7. Storage Quotas and Usage Tracking

- **View**: `public.store_storage_usage` summarizes:
  - Total active assets (`total_assets`)
  - Total bytes consumed (`total_bytes_used`)
  - Category breakdown: product images, branding logos, and AI-generated assets
- **Service**: `StoreAssetService.getStoreUsage(storeId)` queries current asset metrics against a 500 MB base storage quota.

---

## 8. Verification Results

All 19 test files (172 tests) passed with zero regressions:

- `src/test/multi-tenant-storage.test.ts` (11 new tests):
  - Verified path construction and parsing for 3 independent stores.
  - Verified Store A cannot overwrite or delete Store B assets.
  - Verified public product delivery loads while private documents require store membership.
  - Verified rejection of oversized files (>10MB) and executable/SVG script payloads.
  - Verified legacy astronomy assets continue loading under Tenant 0.
  - Verified non-collision of concurrent random UUID paths.
  - Verified metadata RLS and usage calculation.
