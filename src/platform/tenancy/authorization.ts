import { ROLE_LEVELS, ROLE_PERMISSIONS, type StoreRole, type StorePermission } from "./constants";

/**
 * Checks whether userRole has at least the required role in the role hierarchy.
 */
export function hasMinimumRole(userRole: StoreRole, requiredRole: StoreRole): boolean {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[requiredRole];
}

/**
 * Evaluates whether a role has administrative privileges in a store.
 */
export function isStoreAdminRole(role: StoreRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Checks whether a given role holds an explicit granular store permission.
 */
export function hasStorePermission(role: StoreRole, permission: StorePermission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return (permissions as readonly string[]).includes(permission);
}

/**
 * Checks if a member is allowed to unilaterally leave a store.
 * Store owners are prevented from leaving without first transferring ownership to another member.
 */
export function canLeaveStore(role: StoreRole): { allowed: boolean; reason?: string } {
  if (role === "owner") {
    return {
      allowed: false,
      reason:
        "Store owner cannot leave the store. Ownership must be transferred to another administrator first.",
    };
  }
  return { allowed: true };
}

/**
 * Checks if a member can be removed from a store.
 * Enforces last-owner protection and permission hierarchy.
 */
export function canRemoveMember(
  requesterRole: StoreRole,
  targetRole: StoreRole,
  isLastOwner: boolean,
): { allowed: boolean; reason?: string } {
  if (requesterRole !== "owner") {
    return {
      allowed: false,
      reason: "Only the store owner can remove team members.",
    };
  }

  if (targetRole === "owner" && isLastOwner) {
    return {
      allowed: false,
      reason:
        "Cannot remove the sole owner of the store. Store ownership must be transferred to another member before removal.",
    };
  }

  return { allowed: true };
}

/**
 * Evaluates whether a member role modification is permitted by the requester.
 * Rules:
 * - Only store owners can promote someone to owner (transfer) or change admin roles.
 * - Store admins cannot modify owner memberships or create other admins.
 */
export function canModifyMemberRole(
  requesterRole: StoreRole,
  targetCurrentRole: StoreRole,
  targetNewRole: StoreRole,
): { allowed: boolean; reason?: string } {
  if (requesterRole !== "owner") {
    return {
      allowed: false,
      reason: "Only the store owner can modify team member roles.",
    };
  }

  if (targetNewRole === "owner" && targetCurrentRole !== "admin") {
    return {
      allowed: false,
      reason: "Ownership can only be transferred to an active store administrator.",
    };
  }

  return { allowed: true };
}

/**
 * Capability check matrix for store actions.
 */
export const STORE_CAPABILITIES = {
  manageBilling: (role: StoreRole) => hasStorePermission(role, "store:billing"),
  archiveStore: (role: StoreRole) => hasStorePermission(role, "store:archive"),
  transferOwnership: (role: StoreRole) => hasStorePermission(role, "store:transfer_ownership"),
  inviteMembers: (role: StoreRole) => hasStorePermission(role, "members:invite"),
  removeMembers: (role: StoreRole, targetRole: StoreRole, isLastOwner: boolean) =>
    canRemoveMember(role, targetRole, isLastOwner).allowed,
  manageDomains: (role: StoreRole) => hasStorePermission(role, "domains:manage"),
  manageCategories: (role: StoreRole) => hasStorePermission(role, "categories:manage"),
  manageDesigns: (role: StoreRole) => hasStorePermission(role, "designs:edit"),
  publishProducts: (role: StoreRole) => hasStorePermission(role, "products:publish"),
  editProductDrafts: (role: StoreRole) => hasStorePermission(role, "products:edit"),
  deleteProducts: (role: StoreRole) => hasStorePermission(role, "products:delete"),
  viewAnalytics: (role: StoreRole) => hasStorePermission(role, "analytics:view"),
  viewStoreAdmin: (role: StoreRole) => hasStorePermission(role, "store:view"),
};
