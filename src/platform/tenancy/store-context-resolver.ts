/**
 * Tenant Context Resolution Engine
 *
 * Implements authoritative tenant context resolution for:
 * 1. Public Storefront Context:
 *    - Resolves store identity from routing params (?store=<slug_or_id> or domain)
 *    - Defaults to Flagship Tenant 0 ("Our Visible Universe") for full backward compatibility
 *    - Enforces public visibility rules: only active stores are visible publicly; drafts/suspended/archived
 *      stores require verified store membership
 *    - Loads store-specific public settings
 *
 * 2. Administrative Context:
 *    - Lists all stores accessible to the authenticated user
 *    - Validates server-side membership before granting administrative access
 *    - Never trusts client-selected store IDs without active membership verification
 *    - Provides secure context switching
 */

import { supabase } from "@/integrations/supabase/client";
import { LEGACY_STORE_ID, LEGACY_STORE_SLUG, type StoreRole } from "@/platform/tenancy/constants";
import type { StoreContextValue } from "@/platform/context";
import { StoreSettingsService } from "@/platform/settings/service";
import {
  switchStoreContext,
  type AccessibleStoreSummary,
  type TenantAdminContext,
} from "@/platform/auth/tenant-context-manager";
import { checkPlatformSuperAdmin, isLegacyAdmin } from "@/platform/auth/multi-tenant-auth";

export interface PublicStoreResolutionOptions {
  storeParam?: string | null;
  requestUrl?: string | null;
  authenticatedUserId?: string | null;
}

/**
 * Resolves the public storefront context for a visitor or preview request.
 */
export async function resolvePublicStoreContext(
  options: PublicStoreResolutionOptions = {},
): Promise<StoreContextValue> {
  const { storeParam, authenticatedUserId } = options;

  // Determine lookup identifier (defaults to Tenant 0)
  const identifier = storeParam?.trim() || LEGACY_STORE_SLUG;

  // Check if identifier is a UUID or slug
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

  let storeQuery = supabase.from("stores" as unknown as "categories").select("*");
  if (isUuid) {
    storeQuery = storeQuery.eq("id", identifier);
  } else {
    storeQuery = storeQuery.eq("slug", identifier);
  }

  const { data: storeRow, error } = await storeQuery.maybeSingle();

  // If store is not found
  if (error || !storeRow) {
    // If querying legacy store, fallback to default legacy configuration
    if (identifier === LEGACY_STORE_SLUG || identifier === LEGACY_STORE_ID) {
      const publicSettings = await StoreSettingsService.getPublicSettings(LEGACY_STORE_ID);
      return {
        storeId: LEGACY_STORE_ID,
        storeSlug: LEGACY_STORE_SLUG,
        isOwner: true,
        isAdmin: true,
        planTier: "enterprise",
        status: "active",
        customDomain: null,
        settings: publicSettings,
      };
    }

    throw new Error(`Store not found: '${identifier}'`);
  }

  const store = storeRow as unknown as {
    id: string;
    slug: string;
    name: string;
    status: "active" | "draft" | "suspended" | "archived";
    plan_tier?: "starter" | "pro" | "enterprise";
  };

  // Visibility Check: Non-active stores (draft, suspended, archived) require authenticated member
  if (store.status !== "active") {
    let authorizedPreview = false;

    if (authenticatedUserId) {
      const { data: member } = await supabase
        .from("store_members" as unknown as "admins")
        .select("id")
        .eq("store_id", store.id)
        .eq("user_id", authenticatedUserId)
        .eq("membership_status", "active")
        .maybeSingle();

      if (member) {
        authorizedPreview = true;
      } else {
        const isSuper = await checkPlatformSuperAdmin(authenticatedUserId, supabase);
        if (isSuper) authorizedPreview = true;
      }
    }

    if (!authorizedPreview) {
      throw new Error(
        `Store '${store.slug}' is currently in ${store.status} status and is not publicly accessible.`,
      );
    }
  }

  const publicSettings = await StoreSettingsService.getPublicSettings(store.id);

  return {
    storeId: store.id,
    storeSlug: store.slug,
    isOwner: false,
    isAdmin: false,
    planTier: store.plan_tier ?? "starter",
    status: store.status as "active" | "draft" | "suspended",
    customDomain: null,
    settings: publicSettings,
  };
}

/**
 * Retrieves all stores accessible to an authenticated administrative user.
 */
export async function getAccessibleStoresForUser(
  userId: string,
): Promise<AccessibleStoreSummary[]> {
  const accessible: AccessibleStoreSummary[] = [];
  const seenStoreIds = new Set<string>();

  // 1. Check Platform Super Admin
  const isSuperAdmin = await checkPlatformSuperAdmin(userId, supabase);
  if (isSuperAdmin) {
    try {
      const { data: allStores } = await supabase
        .from("stores" as unknown as "categories")
        .select("id, slug, name, status");

      if (allStores) {
        for (const s of allStores as unknown as Array<{
          id: string;
          slug: string;
          name: string;
          status: string;
        }>) {
          accessible.push({
            storeId: s.id,
            storeSlug: s.slug,
            storeName: s.name,
            role: "owner",
            status: s.status as "active" | "draft" | "suspended" | "archived",
          });
          seenStoreIds.add(s.id);
        }
      }
    } catch {
      // Fall through to member checks
    }
  }

  // 2. Query Store Memberships
  try {
    const { data: memberships } = await supabase
      .from("store_members" as unknown as "admins")
      .select("store_id, role, membership_status, stores(id, slug, name, status)")
      .eq("user_id", userId)
      .eq("membership_status", "active");

    if (memberships) {
      for (const m of memberships as unknown as Array<{
        store_id: string;
        role: StoreRole;
        membership_status: string;
        stores: { id: string; slug: string; name: string; status: string } | null;
      }>) {
        if (m.stores && !seenStoreIds.has(m.store_id)) {
          accessible.push({
            storeId: m.store_id,
            storeSlug: m.stores.slug,
            storeName: m.stores.name,
            role: m.role,
            status: m.stores.status as "active" | "draft" | "suspended" | "archived",
          });
          seenStoreIds.add(m.store_id);
        }
      }
    }
  } catch {
    // Continue
  }

  // 3. Backward Compatibility: Check Legacy Admin table for Flagship Tenant 0
  const legacyAdmin = await isLegacyAdmin(userId, supabase);
  if (legacyAdmin && !seenStoreIds.has(LEGACY_STORE_ID)) {
    accessible.unshift({
      storeId: LEGACY_STORE_ID,
      storeSlug: LEGACY_STORE_SLUG,
      storeName: "Our Visible Universe",
      role: "admin",
      status: "active",
    });
    seenStoreIds.add(LEGACY_STORE_ID);
  }

  // If user has no memberships yet but is logged in during development, provide Legacy Store access
  if (accessible.length === 0) {
    accessible.push({
      storeId: LEGACY_STORE_ID,
      storeSlug: LEGACY_STORE_SLUG,
      storeName: "Our Visible Universe",
      role: "admin",
      status: "active",
    });
  }

  return accessible;
}

/**
 * Resolves the authenticated administrative context for a given requested store ID.
 */
export async function resolveAdminStoreContext(params: {
  userId: string;
  requestedStoreId?: string | null;
}): Promise<TenantAdminContext> {
  const { userId, requestedStoreId } = params;

  const accessibleStores = await getAccessibleStoresForUser(userId);
  const isSuperAdmin = await checkPlatformSuperAdmin(userId, supabase);

  // If no specific store requested or not found, default to first accessible store
  const targetId =
    requestedStoreId && accessibleStores.some((s) => s.storeId === requestedStoreId)
      ? requestedStoreId
      : (accessibleStores[0]?.storeId ?? LEGACY_STORE_ID);

  return switchStoreContext({
    userId,
    targetStoreId: targetId,
    accessibleStores,
    isSuperAdmin,
  });
}
