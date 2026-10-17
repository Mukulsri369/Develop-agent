# 12 — Authentication, Authorization & Role-Based Access Control

## 1. Role Hierarchy & Permission Model

The SaaS platform enforces a strict multi-tier authorization hierarchy separating platform-level governance from store-level administration:

```
┌────────────────────────────────────────────────────────┐
│               PLATFORM SUPER ADMINISTRATOR             │
│        (Global oversight, billing, tenant lifecycle)   │
└───────────────────────────┬────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│     STORE A (TENANT)      │   │     STORE B (TENANT)      │
├───────────────────────────┤   ├───────────────────────────┤
│ • STORE OWNER             │   │ • STORE OWNER             │
│   (Full store control)    │   │   (Full store control)    │
│ • STORE ADMIN             │   │ • STORE ADMIN             │
│   (Products, categories)  │   │   (Products, categories)  │
│ • STORE EDITOR            │   │ • STORE EDITOR            │
│   (Drafts, features)      │   │   (Drafts, features)      │
└─────────────┬─────────────┘   └─────────────┬─────────────┘
              ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│      PUBLIC VISITORS      │   │      PUBLIC VISITORS      │
│   (Active products only)  │   │   (Active products only)  │
└───────────────────────────┘   └───────────────────────────┘
```

### Detailed Permission Matrix

| Capability / Action                | Platform Super Admin | Store Owner | Store Admin | Store Editor   | Public Visitor |
| ---------------------------------- | -------------------- | ----------- | ----------- | -------------- | -------------- |
| **Platform Analytics & Health**    | ✅ Full              | ❌ Denied   | ❌ Denied   | ❌ Denied      | ❌ Denied      |
| **Manage Subscription & Billing**  | ✅ Override          | ✅ Full     | ❌ Denied   | ❌ Denied      | ❌ Denied      |
| **Invite / Remove Team Members**   | ✅ Override          | ✅ Full     | ❌ Denied   | ❌ Denied      | ❌ Denied      |
| **Delete / Archive Store**         | ✅ Full              | ✅ Full     | ❌ Denied   | ❌ Denied      | ❌ Denied      |
| **Configure Custom Domain**        | ✅ Full              | ✅ Full     | ❌ Denied   | ❌ Denied      | ❌ Denied      |
| **Publish / Rollback Designs**     | ✅ Full              | ✅ Full     | ✅ Full     | ❌ Denied      | ❌ Denied      |
| **Run AI Design Generation**       | ✅ Full              | ✅ Full     | ✅ Full     | ❌ Denied      | ❌ Denied      |
| **Create / Edit / Trash Products** | ✅ Full              | ✅ Full     | ✅ Full     | ✅ Drafts only | ❌ Denied      |
| **Manage Categories & Taxonomy**   | ✅ Full              | ✅ Full     | ✅ Full     | ❌ Denied      | ❌ Denied      |
| **Upload Product & Brand Media**   | ✅ Full              | ✅ Full     | ✅ Full     | ✅ Products    | ❌ Denied      |
| **View Store Analytics & Clicks**  | ✅ Full              | ✅ Full     | ✅ Full     | ❌ Denied      | ❌ Denied      |
| **Browse Published Storefront**    | ✅ Read              | ✅ Read     | ✅ Read     | ✅ Read        | ✅ Read Active |

---

## 2. Server-Side Permission Verification Functions

All database operations enforce authorization through PostgreSQL `SECURITY DEFINER` helper functions with pinned `search_path = public`:

### Function 1: `is_super_admin()`

```sql
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_super_admins
    WHERE user_id = auth.uid()
  );
$$;
```

### Function 2: `get_store_role(check_store_id uuid)`

```sql
CREATE OR REPLACE FUNCTION public.get_store_role(check_store_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.store_members
  WHERE store_id = check_store_id AND user_id = auth.uid()
  LIMIT 1;
$$;
```

### Function 3: `is_store_admin(check_store_id uuid)`

```sql
CREATE OR REPLACE FUNCTION public.is_store_admin(check_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = check_store_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;
```

### Function 4: `is_store_member(check_store_id uuid)`

```sql
CREATE OR REPLACE FUNCTION public.is_store_member(check_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = check_store_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin', 'editor')
  );
$$;
```

---

## 3. Row Level Security Policies

### Policy Patterns on Core Tables

#### `public.products`

```sql
-- Public read: Live products belonging to active stores
CREATE POLICY "Public reads live store products" ON public.products
FOR SELECT TO anon, authenticated
USING (
  (active AND deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.stores s WHERE s.id = products.store_id AND s.status = 'active'
  ))
  OR public.is_store_member(store_id)
);

-- Member writes: Scoped to verified store members
CREATE POLICY "Store members insert products" ON public.products
FOR INSERT TO authenticated
WITH CHECK (public.is_store_member(store_id));

CREATE POLICY "Store admins update products" ON public.products
FOR UPDATE TO authenticated
USING (public.is_store_member(store_id))
WITH CHECK (public.is_store_member(store_id));

CREATE POLICY "Store admins delete products" ON public.products
FOR DELETE TO authenticated
USING (public.is_store_admin(store_id));
```

#### `storage.objects` (Storage Bucket Isolation)

```sql
-- Storage path structure: store-images/{store_id}/{folder}/{filename}.webp
CREATE POLICY "Store members upload store images" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'store-images'
  AND public.is_store_member((split_part(name, '/', 1))::uuid)
);

CREATE POLICY "Store admins delete store images" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'store-images'
  AND public.is_store_admin((split_part(name, '/', 1))::uuid)
);
```

---

## 4. Multi-Store Switching & Session Management

1. **Single User Account, Multiple Stores**: A creator authenticates once with their email via Supabase Auth.
2. **Store Switcher**:
   - The admin UI queries `supabase.from("store_members").select("store_id, role, stores(name, slug, logo_url)")`.
   - The selected store ID is saved in a secure session cookie (`active_store_id`) and reflected in URL parameters (`/admin/store/:storeId/*`).
3. **Defense-in-Depth Authorization**:
   - Client-side navigation updates the UI layout.
   - Server route loaders verify `is_store_member(params.storeId)`.
   - Every Supabase SQL query carries the authenticated JWT; Postgres RLS silently denies access if `store_id` does not belong to the user's memberships.
   - If a malicious client tries to forge `params.storeId`, the database query returns empty sets or throws permission denied.
