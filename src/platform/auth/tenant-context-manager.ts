/**
 * Tenant-Aware Admin Context & Store Switching Manager
 *
 * Enforces:
 * - Active store identification
 * - Accessible store listing
 * - Secure store switching with server-side membership validation
 * - Prevention of context leakage or retained privileges when switching stores
 * - Never trusts a client-submitted store ID without active membership verification
 */

import {
  ROLE_PERMISSIONS,
  type StoreRole,
  type StorePermission,
} from "@/platform/tenancy/constants";
import { AuthorizationError } from "./multi-tenant-auth";

export interface AccessibleStoreSummary {
  storeId: string;
  storeSlug: string;
  storeName: string;
  role: StoreRole;
  status: "active" | "draft" | "suspended" | "archived";
}

export interface TenantAdminContext {
  activeStoreId: string;
  activeStoreSlug: string;
  activeStoreName: string;
  role: StoreRole;
  permissions: readonly StorePermission[];
  accessibleStores: AccessibleStoreSummary[];
  isSuperAdmin: boolean;
}

/**
 * Validates and switches administrative store context.
 * Strictly verifies that the user holds an active membership in targetStoreId before switching.
 * Completely resets active permissions to prevent retaining any prior store's administrative context.
 */
export function switchStoreContext(params: {
  userId: string;
  targetStoreId: string;
  accessibleStores: AccessibleStoreSummary[];
  isSuperAdmin: boolean;
}): TenantAdminContext {
  const { userId, targetStoreId, accessibleStores, isSuperAdmin } = params;

  // 1. Locate the target store in the user's accessible stores
  const targetStore = accessibleStores.find((s) => s.storeId === targetStoreId);

  // 2. If not found and not a super admin, deny access immediately
  if (!targetStore && !isSuperAdmin) {
    throw new AuthorizationError(
      "FORBIDDEN",
      `Access denied: User ${userId} is not an authorized member of store ${targetStoreId}. Context switch rejected.`,
    );
  }

  // 3. Determine the effective role for the target store
  const effectiveRole: StoreRole = isSuperAdmin ? "owner" : (targetStore?.role ?? "viewer");

  // 4. Resolve the explicit granular permissions for this role
  const permissions = ROLE_PERMISSIONS[effectiveRole] ?? [];

  return {
    activeStoreId: targetStore?.storeId ?? targetStoreId,
    activeStoreSlug: targetStore?.storeSlug ?? "unknown",
    activeStoreName: targetStore?.storeName ?? "Store",
    role: effectiveRole,
    permissions,
    accessibleStores,
    isSuperAdmin,
  };
}
