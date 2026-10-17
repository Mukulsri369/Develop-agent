# Phase 2 — Prompt 08: Complete Row Level Security & Cross-Tenant Data Isolation

## 1. Executive Summary & Security Objectives

This document establishes the verified Row Level Security (RLS) policies, database triggers, security definer functions, and tenant boundary defenses developed in Phase 2 Prompt 08.

### Core Security Objective

A customer managing **Store A** must never be able to read private data, edit products, modify settings, inspect analytics, or execute administrative operations belonging to **Store B**. Furthermore, changing a `store_id`, route parameter, request body, or client-side identifier must never grant unauthorized cross-tenant privileges.

---

## 2. Authorization Audit Findings & Legacy Vulnerability Remediation

Before applying multi-tenant RLS, an authorization audit of the legacy schema revealed several critical cross-tenant vulnerabilities:

1. **Global `is_admin()` Overreach**:
   - _Legacy State_: Database policies evaluated `public.is_admin()`, which granted any approved administrator full write access to all records in `products`, `categories`, `site_settings`, and `storage.objects`.
   - _Remediation_: Deprecated reliance on global `is_admin()` for store entities. Replaced with store-scoped helper functions: `is_store_member(store_id)`, `is_store_editor(store_id)`, `is_store_admin(store_id)`, and `is_store_owner(store_id)`.

2. **Unconstrained UPDATE Operations (`store_id` Transfer Attack)**:
   - _Vulnerability_: In standard Postgres RLS, an UPDATE policy without immutable key constraints allows an attacker with write access in Store A to set `store_id = Store_B_ID`, transferring a record across tenant boundaries.
   - _Remediation_: Implemented database trigger `public.prevent_store_id_mutation()` on `products`, `categories`, `outbound_clicks`, `store_domains`, `store_members`, `store_invitations`, and `store_settings`. Any attempt to mutate `store_id` on an existing row raises exception `42501` and aborts the transaction.

3. **Child Entity Reparenting Attack (`product_id` Tampering)**:
   - _Vulnerability_: An attacker could attempt to reparent an image, tag, or feature to a product belonging to another store.
   - _Remediation_: Implemented database trigger `public.prevent_product_id_mutation()` on `product_images`, `product_features`, and `product_tags`.

4. **Public Exposure of Suspended Store Content**:
   - _Vulnerability_: Public visitors could view live products even if the parent store was suspended or archived.
   - _Remediation_: Hardened `public.product_is_live(uuid)` and product SELECT policies to verify `public.store_is_active(p.store_id)`.

5. **Storage Bucket Cross-Tenant Overwrite**:
   - _Vulnerability_: Supabase Storage bucket `store-images` had a single flat namespace where any admin could delete or overwrite any image.
   - _Remediation_: Partitioned storage paths by tenant root folder: `[store_id]/products/...`. Storage RLS policies enforce that users can only upload, update, or delete files inside their own store's folder partition.

---

## 3. Comprehensive Database RLS Matrix

| Entity                     | Operation              |    Public Visitor     |  Store Viewer  |   Store Editor   |    Store Admin    |         Store Owner          | Platform Super Admin |
| -------------------------- | ---------------------- | :-------------------: | :------------: | :--------------: | :---------------: | :--------------------------: | :------------------: |
| **stores**                 | `SELECT`               |      Active Only      |   Own Store    |    Own Store     |     Own Store     |          Own Store           |      All Stores      |
|                            | `INSERT`               |          ❌           |       ❌       |        ❌        |        ❌         | ✅ (`owner_id = auth.uid()`) |          ✅          |
|                            | `UPDATE`               |          ❌           |       ❌       |        ❌        |        ❌         |              ✅              |          ✅          |
|                            | `DELETE`               |          ❌           |       ❌       |        ❌        |        ❌         |              ✅              |          ✅          |
| **store_settings**         | `SELECT`               |      Public View      |   Own Store    |    Own Store     |     Own Store     |          Own Store           |      All Stores      |
|                            | `INSERT`               |          ❌           |       ❌       |        ❌        |        ✅         |              ✅              |          ✅          |
|                            | `UPDATE`               |          ❌           |       ❌       |        ❌        |        ✅         |              ✅              |          ✅          |
|                            | `DELETE`               |          ❌           |       ❌       |        ❌        |        ❌         |              ✅              |          ✅          |
| **store_members**          | `SELECT`               |          ❌           |   Self Only    |    Self Only     |     Own Store     |          Own Store           |      All Stores      |
|                            | `INSERT`               |          ❌           |       ❌       |        ❌        |  ✅ (Non-Owner)   |        ✅ (Any Role)         |          ✅          |
|                            | `UPDATE`               |          ❌           |       ❌       |        ❌        |        ❌         |     ✅ (Role Transfers)      |          ✅          |
|                            | `DELETE`               |          ❌           |  Self (Leave)  |   Self (Leave)   |  ✅ (Non-Owner)   |     ✅ (Non-Last Owner)      |          ✅          |
| **store_domains**          | `SELECT`               |     Verified Only     |   Own Store    |    Own Store     |     Own Store     |          Own Store           |      All Stores      |
|                            | `INSERT/UPDATE/DELETE` |          ❌           |       ❌       |        ❌        |        ✅         |              ✅              |          ✅          |
| **products**               | `SELECT`               |  Live & Active Store  |   Own Store    |    Own Store     |     Own Store     |          Own Store           |      All Stores      |
|                            | `INSERT`               |          ❌           |       ❌       | ✅ (Drafts only) | ✅ (Draft & Live) |      ✅ (Draft & Live)       |          ✅          |
|                            | `UPDATE`               |          ❌           |       ❌       | ✅ (Drafts only) | ✅ (Draft & Live) |      ✅ (Draft & Live)       |          ✅          |
|                            | `DELETE`               |          ❌           |       ❌       |        ❌        |        ✅         |              ✅              |          ✅          |
| **categories**             | `SELECT`               | Active & Active Store |   Own Store    |    Own Store     |     Own Store     |          Own Store           |      All Stores      |
|                            | `INSERT/UPDATE/DELETE` |          ❌           |       ❌       |        ❌        |        ✅         |              ✅              |          ✅          |
| **product_images**         | `SELECT`               |     Live Products     |   Own Store    |    Own Store     |     Own Store     |          Own Store           |      All Stores      |
|                            | `INSERT/UPDATE/DELETE` |          ❌           |       ❌       |        ✅        |        ✅         |              ✅              |          ✅          |
| **outbound_clicks**        | `SELECT`               |          ❌           |       ❌       |        ❌        |     Own Store     |          Own Store           |      All Stores      |
|                            | `INSERT`               |    ✅ (Live Only)     | ✅ (Live Only) |  ✅ (Live Only)  |  ✅ (Live Only)   |        ✅ (Live Only)        |          ✅          |
|                            | `UPDATE`               |    ❌ (Immutable)     | ❌ (Immutable) |  ❌ (Immutable)  |  ❌ (Immutable)   |        ❌ (Immutable)        |          ❌          |
|                            | `DELETE`               |          ❌           |       ❌       |        ❌        |        ❌         |              ✅              |          ✅          |
| **storage (store-images)** | `SELECT`               |      Public Read      |  Public Read   |   Public Read    |    Public Read    |         Public Read          |         All          |
|                            | `INSERT/UPDATE`        |          ❌           |       ❌       |    Own Folder    |    Own Folder     |          Own Folder          |     All Folders      |
|                            | `DELETE`               |          ❌           |       ❌       |        ❌        |    Own Folder     |          Own Folder          |     All Folders      |

---

## 4. Anti-Tampering Triggers & Immutability Rules

### `prevent_store_id_mutation()`

Prevents any authenticated user or application bug from changing a record's `store_id` after creation:

```sql
CREATE OR REPLACE FUNCTION public.prevent_store_id_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.store_id IS NOT NULL AND NEW.store_id IS DISTINCT FROM OLD.store_id THEN
      RAISE EXCEPTION 'Cross-tenant mutation forbidden: store_id cannot be changed once assigned.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
```

### `prevent_product_id_mutation()`

Prevents moving child resources (images, tags, features) between parent products:

```sql
CREATE OR REPLACE FUNCTION public.prevent_product_id_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.product_id IS NOT NULL AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      RAISE EXCEPTION 'Cross-product mutation forbidden: product_id cannot be changed once assigned.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
```

---

## 5. Storage Partitioning & Path Scoping

Supabase Storage bucket `store-images` enforces path prefixes matching the tenant's UUID:
`[store_id]/products/[image_name].[ext]`

Storage RLS evaluates:

```sql
CREATE POLICY "Store editors upload store images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'store-images'
    AND (
      public.is_super_admin()
      OR (
        (storage.foldername(name))[1] IS NOT NULL
        AND public.is_store_editor(((storage.foldername(name))[1])::uuid)
      )
      OR (
        (storage.foldername(name))[1] IS NULL
        AND public.is_store_editor('00000000-0000-0000-0000-000000000001'::uuid)
      )
    )
  );
```

Legacy files at the bucket root without a folder prefix remain accessible to Tenant 0 (`Our Visible Universe`) administrators, preserving 100% backward compatibility.

---

## 6. Automated Penetration & Isolation Test Results

Vitest test suite `src/test/cross-tenant-rls.test.ts` executes **24 comprehensive security tests** covering:

- **Cross-Tenant SELECT**: Verified that draft products and settings of Store B are completely invisible to Store A admins and anonymous visitors.
- **Cross-Tenant INSERT**: Verified that injecting records with another store's `store_id` is rejected.
- **Cross-Tenant UPDATE**: Verified that Store A admins cannot update Store B products.
- **Anti-Tampering Transfer Attacks**: Verified that mutating `store_id` on an existing product raises `Cross-tenant mutation forbidden`.
- **Privilege Separation**: Verified that Store Editors can only create and edit drafts, while publishing requires Store Admin role.
- **Store Member Protection**: Verified that Store Admins cannot promote themselves to Owner nor delete the Store Owner.
- **Click Tracking Integrity**: Verified that forged click events with mismatched `store_id` are rejected, and click analytics cannot be read across stores.
- **Storage Path Isolation**: Verified that Store A editors cannot upload or delete images in Store B's partition folder.

---

## 7. Rollback & Staging Recovery Script

If migration 0012 needs to be reversed during staging verification:

```sql
-- Revert Storage Policies
DROP POLICY IF EXISTS "Store editors upload store images" ON storage.objects;
DROP POLICY IF EXISTS "Store editors update store images" ON storage.objects;
DROP POLICY IF EXISTS "Store admins delete store images" ON storage.objects;
DROP POLICY IF EXISTS "Public reads store images" ON storage.objects;

-- Revert Outbound Clicks
DROP POLICY IF EXISTS "Anyone logs clicks on live products" ON public.outbound_clicks;
DROP POLICY IF EXISTS "Store admins read own clicks" ON public.outbound_clicks;
DROP POLICY IF EXISTS "Store owners delete own clicks" ON public.outbound_clicks;
DROP TRIGGER IF EXISTS trg_sync_click_store_id ON public.outbound_clicks;
DROP TRIGGER IF EXISTS trg_prevent_click_store_mutation ON public.outbound_clicks;

-- Revert Product Children
DROP TRIGGER IF EXISTS trg_prevent_image_product_mutation ON public.product_images;
DROP TRIGGER IF EXISTS trg_prevent_feature_product_mutation ON public.product_features;
DROP TRIGGER IF EXISTS trg_prevent_tag_product_mutation ON public.product_tags;

-- Revert Products & Categories
DROP TRIGGER IF EXISTS trg_prevent_product_store_mutation ON public.products;
DROP TRIGGER IF EXISTS trg_prevent_category_store_mutation ON public.categories;

-- Revert Store Settings
DROP VIEW IF EXISTS public.public_store_settings;
DROP TABLE IF EXISTS public.store_settings;

-- Revert Helper Functions
DROP FUNCTION IF EXISTS public.is_store_owner(uuid);
DROP FUNCTION IF EXISTS public.is_store_editor(uuid);
DROP FUNCTION IF EXISTS public.product_store_id(uuid);
DROP FUNCTION IF EXISTS public.store_is_active(uuid);
```
