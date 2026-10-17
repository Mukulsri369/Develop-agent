/**
 * Multi-Tenant Store Membership & Invitation Workflow Service
 *
 * Implements:
 * - Secure cryptographically random invitation creation with 7-day expiration
 * - Single-use invitation redemption with email identity binding
 * - Invitation revocation
 * - Team member removal with strict last-owner protection
 * - Role escalation defense and role hierarchy enforcement
 * - Unilateral store exit workflows with owner transfer protection
 */

import type { StoreRole } from "@/platform/tenancy/constants";
import {
  canLeaveStore,
  canRemoveMember,
  canModifyMemberRole,
  hasStorePermission,
} from "@/platform/tenancy/authorization";

export class InvitationError extends Error {
  constructor(
    public readonly code:
      | "INVITATION_NOT_FOUND"
      | "INVITATION_EXPIRED"
      | "IDENTITY_MISMATCH"
      | "ALREADY_ACCEPTED"
      | "UNAUTHORIZED",
    message: string,
  ) {
    super(`[Invitation Workflow] ${code}: ${message}`);
    this.name = "InvitationError";
  }
}

export class MembershipWorkflowError extends Error {
  constructor(
    public readonly code:
      | "LAST_OWNER_PROTECTION"
      | "UNAUTHORIZED_ESCALATION"
      | "OWNER_CANNOT_LEAVE"
      | "DUPLICATE_MEMBERSHIP"
      | "FORBIDDEN",
    message: string,
  ) {
    super(`[Membership Workflow] ${code}: ${message}`);
    this.name = "MembershipWorkflowError";
  }
}

export interface InvitationRecord {
  id: string;
  store_id: string;
  email: string;
  role: Extract<StoreRole, "admin" | "editor" | "viewer">;
  token: string;
  expires_at: string;
  created_at: string;
  created_by: string | null;
  accepted_at?: string | null;
}

export interface MembershipRecord {
  id: string;
  store_id: string;
  user_id: string;
  role: StoreRole;
  membership_status: "active" | "invited" | "suspended";
  created_at: string;
}

/**
 * Validates and creates a secure store invitation.
 */
export function buildStoreInvitation(params: {
  storeId: string;
  email: string;
  role: Extract<StoreRole, "admin" | "editor" | "viewer">;
  callerId: string;
  callerRole: StoreRole;
}): InvitationRecord {
  if (!hasStorePermission(params.callerRole, "members:invite")) {
    throw new MembershipWorkflowError(
      "FORBIDDEN",
      `Role '${params.callerRole}' does not have permission to invite new members.`,
    );
  }

  const cleanEmail = params.email.trim().toLowerCase();
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  return {
    id: crypto.randomUUID(),
    store_id: params.storeId,
    email: cleanEmail,
    role: params.role,
    token,
    expires_at: expiresAt.toISOString(),
    created_at: now.toISOString(),
    created_by: params.callerId,
    accepted_at: null,
  };
}

/**
 * Validates whether an invitation token can be accepted by the redeeming user.
 * Enforces:
 * 1. Token exists and is not already accepted (single-use protection)
 * 2. Token is not expired
 * 3. Redeeming user's email matches the invitation email (case-insensitive)
 */
export function validateInvitationAcceptance(params: {
  invitation: InvitationRecord;
  redeemingUserId: string;
  redeemingUserEmail: string;
}): { valid: boolean; newMembership: MembershipRecord } {
  const { invitation, redeemingUserId, redeemingUserEmail } = params;

  // 1. Single-use check
  if (invitation.accepted_at) {
    throw new InvitationError(
      "ALREADY_ACCEPTED",
      "This invitation has already been accepted and cannot be reused.",
    );
  }

  // 2. Expiration check
  const now = new Date();
  const expiresAt = new Date(invitation.expires_at);
  if (now > expiresAt) {
    throw new InvitationError(
      "INVITATION_EXPIRED",
      "This invitation has expired. Please request a new invitation from the store administrator.",
    );
  }

  // 3. Email identity binding check
  const expectedEmail = invitation.email.trim().toLowerCase();
  const actualEmail = redeemingUserEmail.trim().toLowerCase();
  if (expectedEmail !== actualEmail) {
    throw new InvitationError(
      "IDENTITY_MISMATCH",
      `This invitation was issued to '${expectedEmail}', but the current signed-in account is '${actualEmail}'. Please sign in with the invited email address.`,
    );
  }

  const newMembership: MembershipRecord = {
    id: crypto.randomUUID(),
    store_id: invitation.store_id,
    user_id: redeemingUserId,
    role: invitation.role,
    membership_status: "active",
    created_at: now.toISOString(),
  };

  return {
    valid: true,
    newMembership,
  };
}

/**
 * Validates member removal with last-owner protection.
 */
export function validateMemberRemoval(params: {
  callerRole: StoreRole;
  targetRole: StoreRole;
  isTargetLastOwner: boolean;
}): { allowed: boolean } {
  const removalCheck = canRemoveMember(
    params.callerRole,
    params.targetRole,
    params.isTargetLastOwner,
  );
  if (!removalCheck.allowed) {
    throw new MembershipWorkflowError(
      params.isTargetLastOwner ? "LAST_OWNER_PROTECTION" : "FORBIDDEN",
      removalCheck.reason || "Member removal disallowed.",
    );
  }
  return { allowed: true };
}

/**
 * Validates member role modification and defends against unauthorized escalation.
 */
export function validateRoleModification(params: {
  callerRole: StoreRole;
  targetCurrentRole: StoreRole;
  targetNewRole: StoreRole;
}): { allowed: boolean } {
  const modCheck = canModifyMemberRole(
    params.callerRole,
    params.targetCurrentRole,
    params.targetNewRole,
  );
  if (!modCheck.allowed) {
    throw new MembershipWorkflowError(
      "UNAUTHORIZED_ESCALATION",
      modCheck.reason || "Role modification disallowed.",
    );
  }
  return { allowed: true };
}

/**
 * Validates unilateral store exit.
 * Blocks the store owner from leaving without transferring ownership first.
 */
export function validateStoreExit(callerRole: StoreRole): { allowed: boolean } {
  const exitCheck = canLeaveStore(callerRole);
  if (!exitCheck.allowed) {
    throw new MembershipWorkflowError(
      "OWNER_CANNOT_LEAVE",
      exitCheck.reason || "Store exit disallowed.",
    );
  }
  return { allowed: true };
}
