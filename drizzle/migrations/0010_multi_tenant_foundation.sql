-- ==============================================================================
-- Migration 0010: Multi-Tenant Database Foundation & Store Architecture
-- ==============================================================================
-- Description: Establishes foundational multi-tenant data entities:
--  1. public.platform_super_admins (global SaaS administration)
--  2. Security Definer functions (is_super_admin, get_store_role, is_store_admin, is_store_member)
--  3. public.stores (tenant root entity)
--  4. public.store_members (user-to-store tenancy mappings & role hierarchy)
--  5. public.store_domains (subdomain & custom domain routing registry)
--  6. public.store_invitations (collaborator team invitations)
--  7. Idempotent Tenant 0 genesis for legacy "Our Visible Universe" storefront
-- ==============================================================================

-- 1. Platform Super Administrators
CREATE TABLE IF NOT EXISTS public.platform_super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  CONSTRAINT platform_super_admins_user_id_key UNIQUE (user_id)
);

ALTER TABLE public.platform_super_admins ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.platform_super_admins TO authenticated;
GRANT ALL ON public.platform_super_admins TO service_role;

-- 2. Authorization Helper Functions (pinned search_path for SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_super_admins
    WHERE user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;

-- Policies for platform_super_admins (restricted strictly to super admins)
DROP POLICY IF EXISTS "Super admins view super admins" ON public.platform_super_admins;
CREATE POLICY "Super admins view super admins" ON public.platform_super_admins
  FOR SELECT TO authenticated USING (public.is_super_admin());

DROP POLICY IF EXISTS "Super admins insert super admins" ON public.platform_super_admins;
CREATE POLICY "Super admins insert super admins" ON public.platform_super_admins
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Super admins update super admins" ON public.platform_super_admins;
CREATE POLICY "Super admins update super admins" ON public.platform_super_admins
  FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Super admins delete super admins" ON public.platform_super_admins;
CREATE POLICY "Super admins delete super admins" ON public.platform_super_admins
  FOR DELETE TO authenticated USING (public.is_super_admin());

-- 3. Stores (Tenants)
CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'suspended', 'archived')),
  onboarding_state text NOT NULL DEFAULT 'initial' CHECK (onboarding_state IN ('initial', 'details_provided', 'theme_generated', 'customized', 'ready')),
  is_publicly_listed boolean NOT NULL DEFAULT false,
  plan_tier text NOT NULL DEFAULT 'starter' CHECK (plan_tier IN ('starter', 'pro', 'enterprise')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT stores_slug_unique UNIQUE (slug),
  CONSTRAINT stores_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$')
);

CREATE INDEX IF NOT EXISTS stores_slug_idx ON public.stores(slug);
CREATE INDEX IF NOT EXISTS stores_owner_idx ON public.stores(owner_id);
CREATE INDEX IF NOT EXISTS stores_status_idx ON public.stores(status);

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.stores TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores TO authenticated;
GRANT ALL ON public.stores TO service_role;

DROP TRIGGER IF EXISTS stores_updated ON public.stores;
CREATE TRIGGER stores_updated BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Store Members (Tenancy membership & role assignments)
CREATE TABLE IF NOT EXISTS public.store_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  membership_status text NOT NULL DEFAULT 'active' CHECK (membership_status IN ('active', 'invited', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_members_store_user_unique UNIQUE (store_id, user_id)
);

CREATE INDEX IF NOT EXISTS store_members_lookup_idx ON public.store_members(user_id, store_id);
CREATE INDEX IF NOT EXISTS store_members_store_idx ON public.store_members(store_id);

ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_members TO authenticated;
GRANT ALL ON public.store_members TO service_role;

DROP TRIGGER IF EXISTS store_members_updated ON public.store_members;
CREATE TRIGGER store_members_updated BEFORE UPDATE ON public.store_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Role resolution functions (defined after store_members table exists)
CREATE OR REPLACE FUNCTION public.get_store_role(check_store_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.store_members
  WHERE store_id = check_store_id AND user_id = auth.uid()
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_store_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_store_admin(check_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = check_store_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_store_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_store_member(check_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = check_store_id
      AND user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_store_member(uuid) TO authenticated;

-- Policies for stores
DROP POLICY IF EXISTS "Public reads active stores" ON public.stores;
CREATE POLICY "Public reads active stores" ON public.stores
  FOR SELECT TO anon, authenticated
  USING (status = 'active' OR public.is_store_member(id));

DROP POLICY IF EXISTS "Authenticated users create stores" ON public.stores;
CREATE POLICY "Authenticated users create stores" ON public.stores
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Store owners and super admins update stores" ON public.stores;
CREATE POLICY "Store owners and super admins update stores" ON public.stores
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_super_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "Store owners and super admins delete stores" ON public.stores;
CREATE POLICY "Store owners and super admins delete stores" ON public.stores
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.is_super_admin());

-- Policies for store_members (non-recursive)
DROP POLICY IF EXISTS "Members read store members" ON public.store_members;
CREATE POLICY "Members read store members" ON public.store_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_store_admin(store_id));

DROP POLICY IF EXISTS "Store admins insert store members" ON public.store_members;
CREATE POLICY "Store admins insert store members" ON public.store_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_store_admin(store_id));

DROP POLICY IF EXISTS "Store admins update store members" ON public.store_members;
CREATE POLICY "Store admins update store members" ON public.store_members
  FOR UPDATE TO authenticated
  USING (public.is_store_admin(store_id))
  WITH CHECK (public.is_store_admin(store_id));

DROP POLICY IF EXISTS "Store admins or self delete store members" ON public.store_members;
CREATE POLICY "Store admins or self delete store members" ON public.store_members
  FOR DELETE TO authenticated
  USING (public.is_store_admin(store_id) OR (user_id = auth.uid() AND role != 'owner'));

-- 5. Store Domains (Subdomain & custom domain routing registry)
CREATE TABLE IF NOT EXISTS public.store_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  domain_type text NOT NULL DEFAULT 'subdomain' CHECK (domain_type IN ('subdomain', 'custom')),
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'failed')),
  verification_txt text,
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_domains_hostname_unique UNIQUE (hostname)
);

CREATE INDEX IF NOT EXISTS store_domains_hostname_idx ON public.store_domains(hostname);
CREATE INDEX IF NOT EXISTS store_domains_store_idx ON public.store_domains(store_id);

ALTER TABLE public.store_domains ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.store_domains TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_domains TO authenticated;
GRANT ALL ON public.store_domains TO service_role;

DROP TRIGGER IF EXISTS store_domains_updated ON public.store_domains;
CREATE TRIGGER store_domains_updated BEFORE UPDATE ON public.store_domains FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Policies for store_domains
DROP POLICY IF EXISTS "Public reads verified domains" ON public.store_domains;
CREATE POLICY "Public reads verified domains" ON public.store_domains
  FOR SELECT TO anon, authenticated
  USING (verification_status = 'verified' OR public.is_store_admin(store_id));

DROP POLICY IF EXISTS "Store admins insert domains" ON public.store_domains;
CREATE POLICY "Store admins insert domains" ON public.store_domains
  FOR INSERT TO authenticated
  WITH CHECK (public.is_store_admin(store_id));

DROP POLICY IF EXISTS "Store admins update domains" ON public.store_domains;
CREATE POLICY "Store admins update domains" ON public.store_domains
  FOR UPDATE TO authenticated
  USING (public.is_store_admin(store_id))
  WITH CHECK (public.is_store_admin(store_id));

DROP POLICY IF EXISTS "Store admins delete domains" ON public.store_domains;
CREATE POLICY "Store admins delete domains" ON public.store_domains
  FOR DELETE TO authenticated
  USING (public.is_store_admin(store_id));

-- 6. Store Invitations
CREATE TABLE IF NOT EXISTS public.store_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT store_invitations_token_unique UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS store_invitations_token_idx ON public.store_invitations(token);
CREATE INDEX IF NOT EXISTS store_invitations_store_idx ON public.store_invitations(store_id);

ALTER TABLE public.store_invitations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.store_invitations TO authenticated;
GRANT ALL ON public.store_invitations TO service_role;

DROP POLICY IF EXISTS "Store admins read invitations" ON public.store_invitations;
CREATE POLICY "Store admins read invitations" ON public.store_invitations
  FOR SELECT TO authenticated
  USING (public.is_store_admin(store_id));

DROP POLICY IF EXISTS "Store admins insert invitations" ON public.store_invitations;
CREATE POLICY "Store admins insert invitations" ON public.store_invitations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_store_admin(store_id));

DROP POLICY IF EXISTS "Store admins delete invitations" ON public.store_invitations;
CREATE POLICY "Store admins delete invitations" ON public.store_invitations
  FOR DELETE TO authenticated
  USING (public.is_store_admin(store_id));

-- 7. Tenant 0 Genesis (Flagship Our Visible Universe Store)
-- Safely inserts Tenant 0 only when a user account exists in auth.users
DO $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT id INTO v_owner_id FROM auth.users ORDER BY created_at ASC LIMIT 1;
  IF v_owner_id IS NOT NULL THEN
    INSERT INTO public.stores (
      id,
      name,
      slug,
      owner_id,
      status,
      onboarding_state,
      is_publicly_listed,
      plan_tier
    )
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      'Our Visible Universe',
      'ourvisibleuniverse',
      v_owner_id,
      'active',
      'ready',
      true,
      'enterprise'
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      status = EXCLUDED.status;

    INSERT INTO public.store_members (
      store_id,
      user_id,
      role,
      membership_status
    )
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      v_owner_id,
      'owner',
      'active'
    )
    ON CONFLICT (store_id, user_id) DO NOTHING;
  END IF;
END $$;
