/**
 * Multi-Tenant Authentication & Authorization Service
 *
 * Implements strict multi-tenant authorization:
 * - Server-side identity resolution using verified Supabase Auth claims
 * - Membership verification with status checks (suspended/removed members lose access immediately)
 * - Role hierarchy enforcement and granular permission checks
 * - Platform Super Administrator global oversight
 * - Legacy store (Tenant 0) backward compatibility
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  LEGACY_STORE_ID,
  ROLE_LEVELS,
  type StoreRole,
  type StorePermission,
} from "@/platform/tenancy/constants";
import { hasStorePermission, hasMinimumRole } from "@/platform/tenancy/authorization";
import type { StoreMember } from "@/platform/tenancy/types";

export class AuthorizationError extends Error {
  constructor(
    public readonly code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "MEMBERSHIP_NOT_FOUND"
      | "MEMBERSHIP_SUSPENDED"
      | "INSUFFICIENT_ROLE"
      | "MISSING_PERMISSION",
    message: string,
  ) {
    super(`[Authorization] ${code}: ${message}`);
    this.name = "AuthorizationError";
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  isSuperAdmin: boolean;
}

export interface StoreMembershipRecord {
  id: string;
  store_id: string;
  user_id: string;
  role: StoreRole;
  membership_status: "active" | "invited" | "suspended";
}

/**
 * Resolves the authenticated user from the Supabase client.
 * Never trusts client-submitted user IDs or role headers.
 */
export async function resolveAuthenticatedUser(
  supabase: SupabaseClient<Database>,
): Promise<AuthenticatedUser> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "Valid authentication session or bearer token is required.",
    );
  }

  const userId = data.user.id;
  const email = data.user.email ?? null;

  // Check platform super administrator status
  const isSuperAdmin = await checkPlatformSuperAdmin(userId, supabase);

  return {
    id: userId,
    email,
    isSuperAdmin,
  };
}

/**
 * Checks whether the given user ID belongs to the platform_super_admins table.
 */
export async function checkPlatformSuperAdmin(
  userId: string,
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("platform_super_admins" as unknown as "admins")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

/**
 * Retrieves the store membership for a user.
 * Enforces that membership exists and is active.
 */
export async function getStoreMembership(
  userId: string,
  storeId: string,
  supabase: SupabaseClient<Database>,
): Promise<StoreMembershipRecord | null> {
  try {
    const { data, error } = await supabase
      .from("store_members" as unknown as "admins")
      .select("id, store_id, user_id, role, membership_status")
      .eq("user_id", userId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (error || !data) return null;
    return data as unknown as StoreMembershipRecord;
  } catch {
    return null;
  }
}

/**
 * Enforces that the user is an active member of the store with an optional minimum role.
 * Platform super admins automatically bypass store-level membership requirements.
 */
export async function requireStoreMembership(
  userId: string,
  storeId: string,
  minimumRole?: StoreRole,
  supabase?: SupabaseClient<Database>,
): Promise<{ role: StoreRole; isSuperAdmin: boolean }> {
  if (!supabase) {
    throw new AuthorizationError("UNAUTHENTICATED", "Database client is required.");
  }

  // 1. Check Platform Super Admin bypass
  const isSuperAdmin = await checkPlatformSuperAdmin(userId, supabase);
  if (isSuperAdmin) {
    return { role: "owner", isSuperAdmin: true };
  }

  // 2. Query store membership
  const membership = await getStoreMembership(userId, storeId, supabase);

  if (!membership) {
    // Check legacy compatibility: if storeId is LEGACY_STORE_ID, check legacy admins table
    if (storeId === LEGACY_STORE_ID) {
      const isLegacy = await isLegacyAdmin(userId, supabase);
      if (isLegacy) {
        return { role: "admin", isSuperAdmin: false };
      }
    }

    throw new AuthorizationError(
      "MEMBERSHIP_NOT_FOUND",
      `User ${userId} does not have membership in store ${storeId}.`,
    );
  }

  // 3. Enforce membership status
  if (membership.membership_status !== "active") {
    throw new AuthorizationError(
      "MEMBERSHIP_SUSPENDED",
      `Membership for user ${userId} in store ${storeId} is ${membership.membership_status}.`,
    );
  }

  // 4. Enforce minimum role if specified
  if (minimumRole && !hasMinimumRole(membership.role, minimumRole)) {
    throw new AuthorizationError(
      "INSUFFICIENT_ROLE",
      `Role '${membership.role}' does not satisfy minimum required role '${minimumRole}' (Level ${ROLE_LEVELS[membership.role]} < ${ROLE_LEVELS[minimumRole]}).`,
    );
  }

  return { role: membership.role, isSuperAdmin: false };
}

/**
 * Enforces that the user has an explicit granular permission in the store.
 */
export async function requireStorePermission(
  userId: string,
  storeId: string,
  permission: StorePermission,
  supabase: SupabaseClient<Database>,
): Promise<{ role: StoreRole; isSuperAdmin: boolean }> {
  // Check super admin bypass
  const isSuperAdmin = await checkPlatformSuperAdmin(userId, supabase);
  if (isSuperAdmin) {
    return { role: "owner", isSuperAdmin: true };
  }

  const { role } = await requireStoreMembership(userId, storeId, undefined, supabase);

  if (!hasStorePermission(role, permission)) {
    throw new AuthorizationError(
      "MISSING_PERMISSION",
      `Role '${role}' lacks required permission '${permission}' in store ${storeId}.`,
    );
  }

  return { role, isSuperAdmin: false };
}

/**
 * Evaluates whether a user is an approved administrator in the legacy Our Visible Universe admin table.
 */
export async function isLegacyAdmin(
  userId: string,
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const userEmail = userRes?.user?.email;
    if (!userEmail) return false;

    const { data, error } = await supabase
      .from("admins")
      .select("id")
      .ilike("email", userEmail.trim())
      .maybeSingle();

    if (error || !data) return false;
    return true;
  } catch {
    return false;
  }
}
