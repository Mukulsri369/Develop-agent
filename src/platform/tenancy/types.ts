import type {
  StoreStatus,
  OnboardingState,
  StoreRole,
  MembershipStatus,
  DomainType,
  DomainVerificationStatus,
  PlanTier,
} from "./constants";

export interface Store {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  status: StoreStatus;
  onboarding_state: OnboardingState;
  is_publicly_listed: boolean;
  plan_tier: PlanTier;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface StoreMember {
  id: string;
  store_id: string;
  user_id: string;
  role: StoreRole;
  membership_status: MembershipStatus;
  created_at: string;
  updated_at: string;
}

export interface StoreDomain {
  id: string;
  store_id: string;
  hostname: string;
  domain_type: DomainType;
  verification_status: DomainVerificationStatus;
  verification_txt: string | null;
  is_primary: boolean;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoreInvitation {
  id: string;
  store_id: string;
  email: string;
  role: Extract<StoreRole, "admin" | "editor" | "viewer">;
  token: string;
  expires_at: string;
  created_at: string;
  created_by: string | null;
}

export interface PlatformSuperAdmin {
  id: string;
  user_id: string;
  created_at: string;
  created_by: string | null;
  notes: string | null;
}

export interface UserStoreMembershipSummary {
  storeId: string;
  storeName: string;
  storeSlug: string;
  storeStatus: StoreStatus;
  role: StoreRole;
  membershipStatus: MembershipStatus;
  isOwner: boolean;
  isAdmin: boolean;
}

export interface CreateStoreInput {
  name: string;
  slug: string;
  plan_tier?: PlanTier;
}

export interface UpdateStoreInput {
  name?: string;
  status?: StoreStatus;
  onboarding_state?: OnboardingState;
  is_publicly_listed?: boolean;
}

export interface AddMemberInput {
  storeId: string;
  userId: string;
  role: StoreRole;
}
