/**
 * Multi-Tenant Platform Tenancy Constants
 */

export const LEGACY_STORE_ID = "00000000-0000-0000-0000-000000000001";
export const LEGACY_STORE_SLUG = "ourvisibleuniverse";

export const STORE_STATUSES = ["draft", "active", "suspended", "archived"] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const ONBOARDING_STATES = [
  "initial",
  "details_provided",
  "theme_generated",
  "customized",
  "ready",
] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export const STORE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

export const MEMBERSHIP_STATUSES = ["active", "invited", "suspended"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const DOMAIN_TYPES = ["subdomain", "custom"] as const;
export type DomainType = (typeof DOMAIN_TYPES)[number];

export const DOMAIN_VERIFICATION_STATUSES = ["pending", "verified", "failed"] as const;
export type DomainVerificationStatus = (typeof DOMAIN_VERIFICATION_STATUSES)[number];

export const PLAN_TIERS = ["starter", "pro", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/**
 * Reserved subdomain slugs that cannot be registered by standard stores.
 */
export const RESERVED_SLUGS = [
  "admin",
  "administrator",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "cdn",
  "checkout",
  "dashboard",
  "developer",
  "docs",
  "help",
  "login",
  "logout",
  "oauth",
  "platform",
  "root",
  "settings",
  "signin",
  "signout",
  "signup",
  "staging",
  "static",
  "status",
  "storefront",
  "support",
  "system",
  "test",
  "webhook",
  "www",
] as const;

/**
 * Numerical role hierarchy level for deterministic permission comparison.
 */
export const ROLE_LEVELS: Record<StoreRole, number> = {
  viewer: 10,
  editor: 50,
  admin: 80,
  owner: 100,
};

/**
 * Granular permissions within a store tenant.
 */
export const STORE_PERMISSIONS = [
  "store:view",
  "store:update",
  "store:archive",
  "store:billing",
  "store:transfer_ownership",
  "members:list",
  "members:invite",
  "members:update_role",
  "members:remove",
  "invitations:revoke",
  "domains:view",
  "domains:manage",
  "products:view",
  "products:create",
  "products:edit",
  "products:publish",
  "products:delete",
  "categories:manage",
  "collections:manage",
  "designs:view",
  "designs:edit",
  "designs:publish",
  "analytics:view",
] as const;

export type StorePermission = (typeof STORE_PERMISSIONS)[number];

/**
 * Explicit role-to-permission capability matrix.
 */
export const ROLE_PERMISSIONS: Record<StoreRole, readonly StorePermission[]> = {
  viewer: ["store:view", "products:view", "designs:view", "domains:view"],
  editor: [
    "store:view",
    "products:view",
    "products:create",
    "products:edit",
    "designs:view",
    "designs:edit",
    "domains:view",
  ],
  admin: [
    "store:view",
    "store:update",
    "members:list",
    "members:invite",
    "invitations:revoke",
    "domains:view",
    "domains:manage",
    "products:view",
    "products:create",
    "products:edit",
    "products:publish",
    "products:delete",
    "categories:manage",
    "collections:manage",
    "designs:view",
    "designs:edit",
    "designs:publish",
    "analytics:view",
  ],
  owner: [
    "store:view",
    "store:update",
    "store:archive",
    "store:billing",
    "store:transfer_ownership",
    "members:list",
    "members:invite",
    "members:update_role",
    "members:remove",
    "invitations:revoke",
    "domains:view",
    "domains:manage",
    "products:view",
    "products:create",
    "products:edit",
    "products:publish",
    "products:delete",
    "categories:manage",
    "collections:manage",
    "designs:view",
    "designs:edit",
    "designs:publish",
    "analytics:view",
  ],
};
