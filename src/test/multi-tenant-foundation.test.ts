import { describe, expect, it } from "vitest";
import {
  CreateStoreInputSchema,
  UpdateStoreInputSchema,
  StoreSlugSchema,
  StoreMemberAssignmentSchema,
  StoreDomainInputSchema,
  isValidStoreStatusTransition,
} from "@/platform/tenancy/validation";
import {
  hasMinimumRole,
  isStoreAdminRole,
  canLeaveStore,
  canModifyMemberRole,
  STORE_CAPABILITIES,
} from "@/platform/tenancy/authorization";
import {
  LEGACY_STORE_ID,
  LEGACY_STORE_SLUG,
  RESERVED_SLUGS,
  type StoreRole,
} from "@/platform/tenancy/constants";
import {
  verifyDatabaseIsolation,
  assertSafeMigrationTarget,
  DatabaseMigrationBlockedError,
} from "@/platform/tenancy/database-safety";

describe("Multi-Tenant Foundation — Store Validation & Slug Rules", () => {
  it("accepts valid store creation parameters", () => {
    const input = {
      name: "Starlight Vintage",
      slug: "starlight-vintage",
      plan_tier: "starter" as const,
    };
    const parsed = CreateStoreInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it("normalizes and accepts valid store slugs", () => {
    expect(StoreSlugSchema.parse("Aura-Boutique")).toBe("aura-boutique");
    expect(StoreSlugSchema.parse("shop-123")).toBe("shop-123");
    expect(StoreSlugSchema.parse("cosmic")).toBe("cosmic");
  });

  it("rejects invalid slugs violating length or formatting constraints", () => {
    // Too short (< 3 chars)
    expect(StoreSlugSchema.safeParse("ab").success).toBe(false);

    // Starts or ends with hyphen
    expect(StoreSlugSchema.safeParse("-store").success).toBe(false);
    expect(StoreSlugSchema.safeParse("store-").success).toBe(false);

    // Contains uppercase or special characters
    expect(StoreSlugSchema.safeParse("store_name").success).toBe(false);
    expect(StoreSlugSchema.safeParse("store.shop").success).toBe(false);
    expect(StoreSlugSchema.safeParse("store!").success).toBe(false);
  });

  it("rejects reserved system and platform slugs", () => {
    for (const reserved of ["admin", "api", "dashboard", "checkout", "auth", "billing", "www"]) {
      const result = StoreSlugSchema.safeParse(reserved);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("reserved platform slug");
      }
    }
  });

  it("verifies all reserved slugs in constants list are rejected", () => {
    expect(RESERVED_SLUGS.length).toBeGreaterThan(20);
    expect(RESERVED_SLUGS).toContain("admin");
    expect(RESERVED_SLUGS).toContain("dashboard");
    expect(RESERVED_SLUGS).toContain("settings");
  });
});

describe("Multi-Tenant Foundation — Membership & Role Hierarchy", () => {
  const validStoreId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
  const validUserId = "f9e8d7c6-b5a4-3210-fedc-ba9876543210";

  it("accepts valid store membership roles", () => {
    const roles: StoreRole[] = ["owner", "admin", "editor", "viewer"];
    for (const role of roles) {
      const result = StoreMemberAssignmentSchema.safeParse({
        store_id: validStoreId,
        user_id: validUserId,
        role,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid roles that do not belong to the RBAC matrix", () => {
    const invalidRoles = ["superadmin", "billing_manager", "guest", "root", ""];
    for (const role of invalidRoles) {
      const result = StoreMemberAssignmentSchema.safeParse({
        store_id: validStoreId,
        user_id: validUserId,
        role,
      });
      expect(result.success).toBe(false);
    }
  });

  it("enforces role level comparisons correctly", () => {
    expect(hasMinimumRole("owner", "admin")).toBe(true);
    expect(hasMinimumRole("admin", "editor")).toBe(true);
    expect(hasMinimumRole("editor", "viewer")).toBe(true);
    expect(hasMinimumRole("viewer", "editor")).toBe(false);
    expect(hasMinimumRole("editor", "admin")).toBe(false);
  });

  it("correctly identifies administrative roles", () => {
    expect(isStoreAdminRole("owner")).toBe(true);
    expect(isStoreAdminRole("admin")).toBe(true);
    expect(isStoreAdminRole("editor")).toBe(false);
    expect(isStoreAdminRole("viewer")).toBe(false);
  });

  it("prevents store owner from unilaterally leaving store without transfer", () => {
    const ownerLeave = canLeaveStore("owner");
    expect(ownerLeave.allowed).toBe(false);
    expect(ownerLeave.reason).toContain("cannot leave");

    const adminLeave = canLeaveStore("admin");
    expect(adminLeave.allowed).toBe(true);

    const editorLeave = canLeaveStore("editor");
    expect(editorLeave.allowed).toBe(true);
  });

  it("validates role modification and ownership transfer rules", () => {
    // Only owner can transfer ownership to an admin
    expect(canModifyMemberRole("owner", "admin", "owner").allowed).toBe(true);

    // Cannot transfer ownership directly to an unpromoted editor
    expect(canModifyMemberRole("owner", "editor", "owner").allowed).toBe(false);

    // Admin cannot promote anyone to owner
    expect(canModifyMemberRole("admin", "editor", "admin").allowed).toBe(false);
  });

  it("enforces store capability checks strictly", () => {
    expect(STORE_CAPABILITIES.manageBilling("owner")).toBe(true);
    expect(STORE_CAPABILITIES.manageBilling("admin")).toBe(false);

    expect(STORE_CAPABILITIES.archiveStore("owner")).toBe(true);
    expect(STORE_CAPABILITIES.archiveStore("admin")).toBe(false);

    expect(STORE_CAPABILITIES.manageCategories("admin")).toBe(true);
    expect(STORE_CAPABILITIES.manageCategories("editor")).toBe(false);

    expect(STORE_CAPABILITIES.editProductDrafts("editor")).toBe(true);
    expect(STORE_CAPABILITIES.editProductDrafts("viewer")).toBe(false);
  });
});

describe("Multi-Tenant Foundation — Store Archiving & Status Transitions", () => {
  it("allows valid forward and review status transitions", () => {
    expect(isValidStoreStatusTransition("draft", "active").valid).toBe(true);
    expect(isValidStoreStatusTransition("active", "suspended").valid).toBe(true);
    expect(isValidStoreStatusTransition("active", "archived").valid).toBe(true);
  });

  it("requires archived stores to transition to draft before reactivation", () => {
    const directReactivate = isValidStoreStatusTransition("archived", "active");
    expect(directReactivate.valid).toBe(false);
    expect(directReactivate.reason).toContain("draft");

    const reviewTransition = isValidStoreStatusTransition("archived", "draft");
    expect(reviewTransition.valid).toBe(true);
  });

  it("validates store update payloads strictly", () => {
    const valid = UpdateStoreInputSchema.safeParse({
      name: "New Name",
      status: "active",
      onboarding_state: "ready",
      is_publicly_listed: true,
    });
    expect(valid.success).toBe(true);

    // Reject unknown properties
    const invalid = UpdateStoreInputSchema.safeParse({
      unknown_field: true,
    });
    expect(invalid.success).toBe(false);
  });
});

describe("Multi-Tenant Foundation — Custom Domain Validation", () => {
  const storeId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";

  it("accepts valid domain hostnames", () => {
    expect(
      StoreDomainInputSchema.safeParse({
        store_id: storeId,
        hostname: "shop.auragear.com",
        domain_type: "custom",
      }).success,
    ).toBe(true);

    expect(
      StoreDomainInputSchema.safeParse({
        store_id: storeId,
        hostname: "mystore.platform.dev",
        domain_type: "subdomain",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid domain hostnames with protocols or invalid chars", () => {
    expect(
      StoreDomainInputSchema.safeParse({
        store_id: storeId,
        hostname: "https://shop.auragear.com",
      }).success,
    ).toBe(false);

    expect(
      StoreDomainInputSchema.safeParse({
        store_id: storeId,
        hostname: "shop/path",
      }).success,
    ).toBe(false);
  });
});

describe("Multi-Tenant Foundation — Legacy Store Compatibility & Parity", () => {
  it("preserves constant UUID and slug for Flagship Tenant 0", () => {
    expect(LEGACY_STORE_ID).toBe("00000000-0000-0000-0000-000000000001");
    expect(LEGACY_STORE_SLUG).toBe("ourvisibleuniverse");
  });
});

describe("Multi-Tenant Foundation — Database Isolation & Safety Guard", () => {
  it("detects production database URLs and safely blocks migration execution", () => {
    const prodEnv = {
      VITE_SUPABASE_URL: "https://c--e5dc52fc-4129-47cd-9ba2-1c20a9af2f78-prod.lovable.cloud",
    };
    const status = verifyDatabaseIsolation(prodEnv);
    expect(status.isIsolated).toBe(false);
    expect(status.environment).toBe("production");
    expect(status.canExecuteMigrations).toBe(false);
    expect(status.blockReason).toContain("targets a production instance");

    expect(() => assertSafeMigrationTarget(prodEnv)).toThrow(DatabaseMigrationBlockedError);
  });

  it("detects unconfigured migration URLs and prevents unverified execution", () => {
    const unverifiedEnv = {
      VITE_SUPABASE_URL: "https://staging-project.supabase.co",
      LOVABLE_DB_MIGRATION_URL: "",
    };
    const status = verifyDatabaseIsolation(unverifiedEnv);
    expect(status.isIsolated).toBe(false);
    expect(status.environment).toBe("unverified");
    expect(status.canExecuteMigrations).toBe(false);
    expect(status.blockReason).toContain("No dedicated staging migration connection string");
  });

  it("allows migration execution only when isolated staging environment is confirmed", () => {
    const safeDevEnv = {
      VITE_SUPABASE_URL: "https://staging-project.supabase.co",
      LOVABLE_DB_MIGRATION_URL: "postgres://postgres:password@localhost:54322/postgres",
    };
    const status = verifyDatabaseIsolation(safeDevEnv);
    expect(status.isIsolated).toBe(true);
    expect(status.environment).toBe("development");
    expect(status.canExecuteMigrations).toBe(true);

    expect(() => assertSafeMigrationTarget(safeDevEnv)).not.toThrow();
  });
});
