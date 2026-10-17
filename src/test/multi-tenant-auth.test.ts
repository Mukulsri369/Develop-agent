import { describe, expect, it } from "vitest";
import {
  requireStoreMembership,
  requireStorePermission,
  AuthorizationError,
  type StoreMembershipRecord,
} from "@/platform/auth/multi-tenant-auth";
import {
  buildStoreInvitation,
  validateInvitationAcceptance,
  validateMemberRemoval,
  validateRoleModification,
  validateStoreExit,
  InvitationError,
  MembershipWorkflowError,
  type InvitationRecord,
} from "@/platform/auth/invitation-service";
import {
  switchStoreContext,
  type AccessibleStoreSummary,
} from "@/platform/auth/tenant-context-manager";
import { LEGACY_STORE_ID, hasStorePermission, type StoreRole } from "@/platform/tenancy";

// Helper to create mock Supabase client for testing
function createMockSupabase(params: {
  superAdmins?: string[];
  memberships?: StoreMembershipRecord[];
  legacyAdmins?: string[];
  currentUserEmail?: string;
}) {
  const superAdmins = params.superAdmins ?? [];
  const memberships = params.memberships ?? [];
  const legacyAdmins = params.legacyAdmins ?? [];
  const currentUserEmail = params.currentUserEmail ?? "user@example.com";

  return {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "user-1",
            email: currentUserEmail,
          },
        },
        error: null,
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: (col1: string, val1: string) => ({
          eq: (col2: string, val2: string) => ({
            maybeSingle: async () => {
              if (table === "store_members") {
                const found = memberships.find((m) => m.user_id === val1 && m.store_id === val2);
                return { data: found ?? null, error: null };
              }
              return { data: null, error: null };
            },
          }),
          maybeSingle: async () => {
            if (table === "platform_super_admins") {
              const found = superAdmins.includes(val1);
              return { data: found ? { id: "sa-1" } : null, error: null };
            }
            return { data: null, error: null };
          },
        }),
        ilike: (col: string, val: string) => ({
          maybeSingle: async () => {
            if (table === "admins") {
              const found = legacyAdmins.some((a) => a.toLowerCase() === val.toLowerCase());
              return { data: found ? { id: "admin-1" } : null, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
  } as unknown as Parameters<typeof requireStoreMembership>[3];
}

describe("Multi-Tenant Auth — Role Hierarchy & Access Verification", () => {
  const storeA = "store-aaa-111";
  const storeB = "store-bbb-222";
  const userAlice = "user-alice-owner";
  const userBob = "user-bob-admin";
  const userCharlie = "user-charlie-editor";
  const userDave = "user-dave-viewer";
  const userSuspended = "user-eve-suspended";

  const memberships: StoreMembershipRecord[] = [
    {
      id: "mem-1",
      store_id: storeA,
      user_id: userAlice,
      role: "owner",
      membership_status: "active",
    },
    {
      id: "mem-2",
      store_id: storeA,
      user_id: userBob,
      role: "admin",
      membership_status: "active",
    },
    {
      id: "mem-3",
      store_id: storeA,
      user_id: userCharlie,
      role: "editor",
      membership_status: "active",
    },
    {
      id: "mem-4",
      store_id: storeA,
      user_id: userDave,
      role: "viewer",
      membership_status: "active",
    },
    {
      id: "mem-5",
      store_id: storeA,
      user_id: userSuspended,
      role: "admin",
      membership_status: "suspended",
    },
    {
      id: "mem-6",
      store_id: storeB,
      user_id: userBob,
      role: "owner",
      membership_status: "active",
    },
  ];

  const mockDb = createMockSupabase({ memberships });

  it("allows store owner to access own store", async () => {
    const access = await requireStoreMembership(userAlice, storeA, "owner", mockDb);
    expect(access.role).toBe("owner");
    expect(access.isSuperAdmin).toBe(false);
  });

  it("denies store owner access to another unassigned store", async () => {
    await expect(requireStoreMembership(userAlice, storeB, "viewer", mockDb)).rejects.toThrow(
      AuthorizationError,
    );
  });

  it("allows store admin to perform permitted admin actions", async () => {
    const access = await requireStoreMembership(userBob, storeA, "admin", mockDb);
    expect(access.role).toBe("admin");

    const perm = await requireStorePermission(userBob, storeA, "products:publish", mockDb);
    expect(perm.role).toBe("admin");
  });

  it("blocks store editor from privileged operations like billing and team removal", async () => {
    // Editor satisfies editor role
    const editorAccess = await requireStoreMembership(userCharlie, storeA, "editor", mockDb);
    expect(editorAccess.role).toBe("editor");

    // But editor is blocked when admin role is required
    await expect(requireStoreMembership(userCharlie, storeA, "admin", mockDb)).rejects.toThrow(
      /INSUFFICIENT_ROLE/,
    );

    // Editor is blocked from billing permission
    await expect(
      requireStorePermission(userCharlie, storeA, "store:billing", mockDb),
    ).rejects.toThrow(/MISSING_PERMISSION/);

    // Editor is blocked from archiving store
    await expect(
      requireStorePermission(userCharlie, storeA, "store:archive", mockDb),
    ).rejects.toThrow(/MISSING_PERMISSION/);
  });

  it("blocks public visitor or unassigned user from any admin operations", async () => {
    const anonymousUser = "user-anonymous-visitor";
    await expect(requireStoreMembership(anonymousUser, storeA, "viewer", mockDb)).rejects.toThrow(
      /MEMBERSHIP_NOT_FOUND/,
    );
  });

  it("immediately blocks suspended members from any access", async () => {
    await expect(requireStoreMembership(userSuspended, storeA, "viewer", mockDb)).rejects.toThrow(
      /MEMBERSHIP_SUSPENDED/,
    );
  });
});

describe("Multi-Tenant Auth — Platform Super Administrator Global Oversight", () => {
  const storeA = "store-aaa-111";
  const superAdminUser = "user-super-admin";
  const normalUser = "user-normal";

  const mockDb = createMockSupabase({
    superAdmins: [superAdminUser],
    memberships: [], // Super admin has no explicit row in store_members for storeA
  });

  it("allows platform super admin to access any store with owner privileges", async () => {
    const access = await requireStoreMembership(superAdminUser, storeA, "owner", mockDb);
    expect(access.role).toBe("owner");
    expect(access.isSuperAdmin).toBe(true);

    const perm = await requireStorePermission(
      superAdminUser,
      storeA,
      "store:transfer_ownership",
      mockDb,
    );
    expect(perm.isSuperAdmin).toBe(true);
  });

  it("ensures ordinary users cannot assume platform super admin access", async () => {
    await expect(requireStoreMembership(normalUser, storeA, "viewer", mockDb)).rejects.toThrow(
      AuthorizationError,
    );
  });
});

describe("Multi-Tenant Auth — Legacy Store Compatibility", () => {
  const legacyAdminEmail = "mukul.srivastava.025@gmail.com";
  const legacyAdminUserId = "user-legacy-admin";

  const mockDb = createMockSupabase({
    legacyAdmins: [legacyAdminEmail],
    currentUserEmail: legacyAdminEmail,
    memberships: [], // No multi-tenant membership row yet
  });

  it("recognizes legacy admin for Tenant 0 (Our Visible Universe)", async () => {
    const access = await requireStoreMembership(
      legacyAdminUserId,
      LEGACY_STORE_ID,
      "admin",
      mockDb,
    );
    expect(access.role).toBe("admin");
    expect(access.isSuperAdmin).toBe(false);
  });

  it("denies legacy admin from accessing an unrelated new store without membership", async () => {
    const newStoreId = "store-new-brand-999";
    await expect(
      requireStoreMembership(legacyAdminUserId, newStoreId, "viewer", mockDb),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe("Multi-Tenant Auth — Store Membership Workflows & Invitations", () => {
  const storeId = "store-inv-123";
  const callerOwner = "user-owner-1";
  const callerEditor = "user-editor-1";

  it("creates a cryptographically random invitation with 7-day expiration", () => {
    const inv = buildStoreInvitation({
      storeId,
      email: "colleague@brand.com",
      role: "admin",
      callerId: callerOwner,
      callerRole: "owner",
    });

    expect(inv.token).toBeDefined();
    expect(inv.token.length).toBeGreaterThan(20);
    expect(inv.email).toBe("colleague@brand.com");
    expect(inv.role).toBe("admin");
    expect(inv.accepted_at).toBeNull();

    // Verify 7-day expiration
    const expires = new Date(inv.expires_at).getTime();
    const created = new Date(inv.created_at).getTime();
    const diffDays = Math.round((expires - created) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(7);
  });

  it("blocks non-administrative members from inviting staff", () => {
    expect(() =>
      buildStoreInvitation({
        storeId,
        email: "guest@brand.com",
        role: "viewer",
        callerId: callerEditor,
        callerRole: "editor",
      }),
    ).toThrow(MembershipWorkflowError);
  });

  it("successfully validates invitation acceptance when email matches", () => {
    const inv = buildStoreInvitation({
      storeId,
      email: "staff@brand.com",
      role: "editor",
      callerId: callerOwner,
      callerRole: "owner",
    });

    const res = validateInvitationAcceptance({
      invitation: inv,
      redeemingUserId: "user-new-staff",
      redeemingUserEmail: "staff@brand.com",
    });

    expect(res.valid).toBe(true);
    expect(res.newMembership.store_id).toBe(storeId);
    expect(res.newMembership.user_id).toBe("user-new-staff");
    expect(res.newMembership.role).toBe("editor");
    expect(res.newMembership.membership_status).toBe("active");
  });

  it("rejects invitation acceptance when redeeming email does not match", () => {
    const inv = buildStoreInvitation({
      storeId,
      email: "intended@brand.com",
      role: "editor",
      callerId: callerOwner,
      callerRole: "owner",
    });

    expect(() =>
      validateInvitationAcceptance({
        invitation: inv,
        redeemingUserId: "user-imposter",
        redeemingUserEmail: "other@imposter.com",
      }),
    ).toThrow(/IDENTITY_MISMATCH/);
  });

  it("rejects expired invitations", () => {
    const inv = buildStoreInvitation({
      storeId,
      email: "staff@brand.com",
      role: "editor",
      callerId: callerOwner,
      callerRole: "owner",
    });

    // Artificially expire the invitation
    inv.expires_at = new Date(Date.now() - 1000 * 60).toISOString();

    expect(() =>
      validateInvitationAcceptance({
        invitation: inv,
        redeemingUserId: "user-new-staff",
        redeemingUserEmail: "staff@brand.com",
      }),
    ).toThrow(/INVITATION_EXPIRED/);
  });

  it("rejects duplicate acceptance of already used invitations", () => {
    const inv = buildStoreInvitation({
      storeId,
      email: "staff@brand.com",
      role: "editor",
      callerId: callerOwner,
      callerRole: "owner",
    });

    // Mark as accepted
    inv.accepted_at = new Date().toISOString();

    expect(() =>
      validateInvitationAcceptance({
        invitation: inv,
        redeemingUserId: "user-new-staff",
        redeemingUserEmail: "staff@brand.com",
      }),
    ).toThrow(/ALREADY_ACCEPTED/);
  });
});

describe("Multi-Tenant Auth — Ownership Protection & Last Owner Defense", () => {
  it("prevents removal of the last remaining owner of a store", () => {
    expect(() =>
      validateMemberRemoval({
        callerRole: "owner",
        targetRole: "owner",
        isTargetLastOwner: true,
      }),
    ).toThrow(/LAST_OWNER_PROTECTION/);
  });

  it("allows removal of an owner if another owner exists (co-owner)", () => {
    const res = validateMemberRemoval({
      callerRole: "owner",
      targetRole: "owner",
      isTargetLastOwner: false,
    });
    expect(res.allowed).toBe(true);
  });

  it("prevents non-owners from removing any staff", () => {
    expect(() =>
      validateMemberRemoval({
        callerRole: "admin",
        targetRole: "editor",
        isTargetLastOwner: false,
      }),
    ).toThrow(/FORBIDDEN/);
  });

  it("blocks privilege escalation (editor trying to promote to admin)", () => {
    expect(() =>
      validateRoleModification({
        callerRole: "editor",
        targetCurrentRole: "viewer",
        targetNewRole: "admin",
      }),
    ).toThrow(/UNAUTHORIZED_ESCALATION/);
  });

  it("prevents store owners from unilaterally leaving without transferring ownership", () => {
    expect(() => validateStoreExit("owner")).toThrow(/OWNER_CANNOT_LEAVE/);
    expect(validateStoreExit("admin").allowed).toBe(true);
    expect(validateStoreExit("editor").allowed).toBe(true);
  });
});

describe("Multi-Tenant Auth — Tenant-Aware Context Switching", () => {
  const accessibleStores: AccessibleStoreSummary[] = [
    {
      storeId: "store-alpha",
      storeSlug: "alpha",
      storeName: "Alpha Boutique",
      role: "owner",
      status: "active",
    },
    {
      storeId: "store-beta",
      storeSlug: "beta",
      storeName: "Beta Electronics",
      role: "editor",
      status: "active",
    },
  ];

  it("switches context cleanly between accessible stores and swaps permissions", () => {
    // Switch to Alpha (Owner)
    const contextAlpha = switchStoreContext({
      userId: "user-1",
      targetStoreId: "store-alpha",
      accessibleStores,
      isSuperAdmin: false,
    });

    expect(contextAlpha.activeStoreId).toBe("store-alpha");
    expect(contextAlpha.role).toBe("owner");
    expect(contextAlpha.permissions).toContain("store:billing");
    expect(contextAlpha.permissions).toContain("products:publish");

    // Switch to Beta (Editor)
    const contextBeta = switchStoreContext({
      userId: "user-1",
      targetStoreId: "store-beta",
      accessibleStores,
      isSuperAdmin: false,
    });

    expect(contextBeta.activeStoreId).toBe("store-beta");
    expect(contextBeta.role).toBe("editor");
    // Crucial: Permissions from Alpha (billing, publish) must NOT leak into Beta context
    expect(contextBeta.permissions).not.toContain("store:billing");
    expect(contextBeta.permissions).not.toContain("products:publish");
    expect(contextBeta.permissions).toContain("products:edit");
  });

  it("strictly rejects switching to an unauthorized store", () => {
    expect(() =>
      switchStoreContext({
        userId: "user-1",
        targetStoreId: "store-gamma-unauthorized",
        accessibleStores,
        isSuperAdmin: false,
      }),
    ).toThrow(AuthorizationError);
  });

  it("allows platform super admin to switch to any store with owner privileges", () => {
    const superAdminCtx = switchStoreContext({
      userId: "user-super",
      targetStoreId: "store-gamma-unauthorized",
      accessibleStores,
      isSuperAdmin: true,
    });

    expect(superAdminCtx.activeStoreId).toBe("store-gamma-unauthorized");
    expect(superAdminCtx.role).toBe("owner");
    expect(superAdminCtx.isSuperAdmin).toBe(true);
  });
});
