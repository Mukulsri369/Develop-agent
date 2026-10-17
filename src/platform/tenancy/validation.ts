import { z } from "zod";
import {
  STORE_STATUSES,
  ONBOARDING_STATES,
  STORE_ROLES,
  MEMBERSHIP_STATUSES,
  DOMAIN_TYPES,
  DOMAIN_VERIFICATION_STATUSES,
  PLAN_TIERS,
  RESERVED_SLUGS,
} from "./constants";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const StoreSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Store slug must be at least 3 characters")
  .max(63, "Store slug cannot exceed 63 characters")
  .regex(
    SLUG_REGEX,
    "Store slug can only contain lowercase alphanumeric characters and hyphens, and cannot start or end with a hyphen",
  )
  .refine(
    (slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug),
    (slug) => ({ message: `'${slug}' is a reserved platform slug and cannot be used` }),
  );

export const StoreNameSchema = z
  .string()
  .trim()
  .min(2, "Store name must be at least 2 characters")
  .max(100, "Store name cannot exceed 100 characters");

export const StoreStatusSchema = z.enum(STORE_STATUSES);
export const OnboardingStateSchema = z.enum(ONBOARDING_STATES);
export const StoreRoleSchema = z.enum(STORE_ROLES);
export const MembershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
export const PlanTierSchema = z.enum(PLAN_TIERS);
export const DomainTypeSchema = z.enum(DOMAIN_TYPES);
export const DomainVerificationStatusSchema = z.enum(DOMAIN_VERIFICATION_STATUSES);

export const CreateStoreInputSchema = z.object({
  name: StoreNameSchema,
  slug: StoreSlugSchema,
  plan_tier: PlanTierSchema.default("starter"),
});

export const UpdateStoreInputSchema = z
  .object({
    name: StoreNameSchema.optional(),
    status: StoreStatusSchema.optional(),
    onboarding_state: OnboardingStateSchema.optional(),
    is_publicly_listed: z.boolean().optional(),
  })
  .strict();

export const StoreMemberAssignmentSchema = z.object({
  store_id: z.string().uuid("Invalid store ID format"),
  user_id: z.string().uuid("Invalid user ID format"),
  role: StoreRoleSchema,
  membership_status: MembershipStatusSchema.default("active"),
});

export const StoreDomainInputSchema = z.object({
  store_id: z.string().uuid("Invalid store ID format"),
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Hostname must be at least 3 characters")
    .max(253, "Hostname cannot exceed 253 characters")
    .regex(DOMAIN_REGEX, "Hostname must be a valid domain or subdomain"),
  domain_type: DomainTypeSchema.default("subdomain"),
  is_primary: z.boolean().default(false),
});

export const StoreInvitationInputSchema = z.object({
  store_id: z.string().uuid("Invalid store ID format"),
  email: z.string().trim().toLowerCase().email("Invalid email format"),
  role: z.enum(["admin", "editor", "viewer"]),
});

/**
 * Validates whether a store status transition is allowed.
 * e.g., archived stores cannot transition directly back to active without reactivation review.
 */
export function isValidStoreStatusTransition(
  currentStatus: string,
  targetStatus: string,
): { valid: boolean; reason?: string } {
  if (currentStatus === targetStatus) return { valid: true };

  if (currentStatus === "archived" && targetStatus !== "draft") {
    return {
      valid: false,
      reason: "Archived stores can only transition to 'draft' for restoration review.",
    };
  }

  return { valid: true };
}
