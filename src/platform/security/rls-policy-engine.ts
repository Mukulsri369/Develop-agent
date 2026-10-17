import type { SecurityContext, RlsEvaluationResult, DbOperation } from "./types";
import { ROLE_LEVELS, type StoreRole } from "@/platform/tenancy/constants";

export interface MockStore {
  id: string;
  name: string;
  owner_id: string;
  status: "draft" | "active" | "suspended" | "archived";
}

export interface MockProduct {
  id: string;
  store_id: string;
  name: string;
  slug: string;
  active: boolean;
  deleted_at: string | null;
}

export interface MockCategory {
  id: string;
  store_id: string;
  name: string;
  slug: string;
  active: boolean;
}

export interface MockProductChild {
  id: string;
  product_id: string;
}

export interface MockOutboundClick {
  id: string;
  product_id: string;
  store_id: string;
}

export interface MockStoreMember {
  id: string;
  store_id: string;
  user_id: string;
  role: StoreRole;
  membership_status: "active" | "invited" | "suspended";
}

export interface MockStoreSettings {
  store_id: string;
  store_name: string;
  contact_email?: string | null;
}

/**
 * Checks if the context actor is a platform super administrator.
 */
export function isSuperAdmin(ctx: SecurityContext): boolean {
  return ctx.isSuperAdmin === true;
}

/**
 * Resolves the actor's active role within a specific store.
 */
export function getStoreRole(ctx: SecurityContext, storeId: string): StoreRole | null {
  if (isSuperAdmin(ctx)) return "owner";
  const membership = ctx.storeMemberships.find(
    (m) => m.storeId === storeId && m.status === "active",
  );
  return membership?.role ?? null;
}

/**
 * Checks if the actor is an active member of the specified store.
 */
export function isStoreMember(ctx: SecurityContext, storeId: string): boolean {
  if (isSuperAdmin(ctx)) return true;
  return getStoreRole(ctx, storeId) !== null;
}

/**
 * Checks if the actor has store admin or owner role in the specified store.
 */
export function isStoreAdmin(ctx: SecurityContext, storeId: string): boolean {
  if (isSuperAdmin(ctx)) return true;
  const role = getStoreRole(ctx, storeId);
  return role === "owner" || role === "admin";
}

/**
 * Checks if the actor has editor, admin, or owner role in the specified store.
 */
export function isStoreEditor(ctx: SecurityContext, storeId: string): boolean {
  if (isSuperAdmin(ctx)) return true;
  const role = getStoreRole(ctx, storeId);
  if (!role) return false;
  return ROLE_LEVELS[role] >= ROLE_LEVELS.editor;
}

/**
 * Checks if the actor is the store owner.
 */
export function isStoreOwner(ctx: SecurityContext, storeId: string): boolean {
  if (isSuperAdmin(ctx)) return true;
  return getStoreRole(ctx, storeId) === "owner";
}

/**
 * PostgreSQL RLS Policy Evaluator Engine
 */
export class RlsPolicyEngine {
  constructor(
    private stores: Map<string, MockStore> = new Map(),
    private products: Map<string, MockProduct> = new Map(),
  ) {}

  public registerStore(store: MockStore) {
    this.stores.set(store.id, store);
  }

  public registerProduct(product: MockProduct) {
    this.products.set(product.id, product);
  }

  public isStoreActive(storeId: string): boolean {
    const store = this.stores.get(storeId);
    return store ? store.status === "active" : false;
  }

  public isProductLive(productId: string): boolean {
    const prod = this.products.get(productId);
    if (!prod) return false;
    return prod.active && prod.deleted_at === null && this.isStoreActive(prod.store_id);
  }

  // ==========================================
  // PRODUCTS RLS
  // ==========================================
  public evaluateProduct(
    ctx: SecurityContext,
    op: DbOperation,
    row: MockProduct,
    oldRow?: MockProduct,
  ): RlsEvaluationResult {
    const storeId = row.store_id;

    if (op === "SELECT") {
      // USING ((active AND deleted_at IS NULL AND store_is_active(store_id)) OR is_store_member(store_id))
      const isPublicLive = row.active && row.deleted_at === null && this.isStoreActive(storeId);
      if (isPublicLive || isStoreMember(ctx, storeId)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: "Access denied: product is inactive, in draft, or belongs to another store.",
      };
    }

    if (op === "INSERT") {
      // WITH CHECK (is_store_admin(store_id) OR (is_store_editor(store_id) AND active = false))
      if (!isStoreEditor(ctx, storeId)) {
        return {
          allowed: false,
          reason:
            "Cross-tenant violation: user is not an authorized editor or admin in this store.",
          violatingField: "store_id",
        };
      }
      if (row.active && !isStoreAdmin(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Insufficient privilege: Store Editors can only create draft products.",
          violatingField: "active",
        };
      }
      return { allowed: true };
    }

    if (op === "UPDATE") {
      if (!oldRow) {
        return { allowed: false, reason: "Old row state required for UPDATE evaluation." };
      }
      // Anti-tampering: store_id cannot be mutated across tenants
      if (row.store_id !== oldRow.store_id) {
        return {
          allowed: false,
          reason: "Cross-tenant mutation forbidden: store_id cannot be modified once created.",
          violatingField: "store_id",
        };
      }
      // USING: Must have editor rights in existing store
      if (!isStoreEditor(ctx, oldRow.store_id)) {
        return {
          allowed: false,
          reason: "Cross-tenant violation: user cannot update products in another store.",
          violatingField: "store_id",
        };
      }
      // WITH CHECK: Publishing requires admin role
      if (row.active && !oldRow.active && !isStoreAdmin(ctx, oldRow.store_id)) {
        return {
          allowed: false,
          reason: "Insufficient privilege: Store Editors cannot publish live products.",
          violatingField: "active",
        };
      }
      return { allowed: true };
    }

    if (op === "DELETE") {
      // USING (is_store_admin(store_id))
      if (!isStoreAdmin(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Cross-tenant violation: only Store Admins can delete products in their store.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: "Unsupported operation." };
  }

  // ==========================================
  // CATEGORIES RLS
  // ==========================================
  public evaluateCategory(
    ctx: SecurityContext,
    op: DbOperation,
    row: MockCategory,
    oldRow?: MockCategory,
  ): RlsEvaluationResult {
    const storeId = row.store_id;

    if (op === "SELECT") {
      const isPublicActive = row.active && this.isStoreActive(storeId);
      if (isPublicActive || isStoreMember(ctx, storeId)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: "Access denied: category is inactive or belongs to an unauthenticated store.",
      };
    }

    if (op === "INSERT") {
      if (!isStoreAdmin(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Cross-tenant violation: only Store Admins can create categories in this store.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    if (op === "UPDATE") {
      if (!oldRow) return { allowed: false, reason: "Old row state required for UPDATE." };
      if (row.store_id !== oldRow.store_id) {
        return {
          allowed: false,
          reason: "Cross-tenant mutation forbidden: store_id cannot be changed.",
          violatingField: "store_id",
        };
      }
      if (!isStoreAdmin(ctx, oldRow.store_id)) {
        return {
          allowed: false,
          reason: "Cross-tenant violation: only Store Admins can update categories in this store.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    if (op === "DELETE") {
      if (!isStoreAdmin(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Cross-tenant violation: only Store Admins can delete categories in this store.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: "Unsupported operation." };
  }

  // ==========================================
  // PRODUCT CHILDREN (Images, Features, Tags)
  // ==========================================
  public evaluateProductChild(
    ctx: SecurityContext,
    op: DbOperation,
    row: MockProductChild,
    oldRow?: MockProductChild,
  ): RlsEvaluationResult {
    const parentProd = this.products.get(row.product_id);
    if (!parentProd) {
      return { allowed: false, reason: "Referenced product does not exist." };
    }
    const storeId = parentProd.store_id;

    if (op === "SELECT") {
      if (this.isProductLive(row.product_id) || isStoreMember(ctx, storeId)) {
        return { allowed: true };
      }
      return { allowed: false, reason: "Access denied: parent product is not accessible." };
    }

    if (op === "INSERT") {
      if (!isStoreEditor(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Cross-tenant violation: cannot attach children to another store's product.",
          violatingField: "product_id",
        };
      }
      return { allowed: true };
    }

    if (op === "UPDATE") {
      if (!oldRow) return { allowed: false, reason: "Old row state required for UPDATE." };
      if (row.product_id !== oldRow.product_id) {
        return {
          allowed: false,
          reason: "Cross-product mutation forbidden: product_id cannot be changed.",
          violatingField: "product_id",
        };
      }
      if (!isStoreEditor(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Cross-tenant violation: cannot modify children of another store's product.",
          violatingField: "product_id",
        };
      }
      return { allowed: true };
    }

    if (op === "DELETE") {
      if (!isStoreEditor(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Cross-tenant violation: cannot delete children of another store's product.",
          violatingField: "product_id",
        };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: "Unsupported operation." };
  }

  // ==========================================
  // OUTBOUND CLICKS
  // ==========================================
  public evaluateOutboundClick(
    ctx: SecurityContext,
    op: DbOperation,
    row: MockOutboundClick,
  ): RlsEvaluationResult {
    const parentProd = this.products.get(row.product_id);
    if (!parentProd) {
      return { allowed: false, reason: "Referenced product does not exist." };
    }

    if (op === "INSERT") {
      // Live products only & store_id must match product store_id
      if (!this.isProductLive(row.product_id)) {
        return {
          allowed: false,
          reason: "Click tracking rejected: product is inactive or deleted.",
        };
      }
      if (row.store_id !== parentProd.store_id) {
        return {
          allowed: false,
          reason: "Click tracking rejected: mismatched store_id.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    if (op === "SELECT") {
      // Only store admins can read analytics for their store
      if (!isStoreAdmin(ctx, row.store_id)) {
        return {
          allowed: false,
          reason: "Analytics access denied: must be Store Admin for this store.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    if (op === "UPDATE") {
      return { allowed: false, reason: "Outbound click records are immutable event logs." };
    }

    if (op === "DELETE") {
      if (!isSuperAdmin(ctx) && !isStoreOwner(ctx, row.store_id)) {
        return { allowed: false, reason: "Only store owners or super admins can purge clicks." };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: "Unsupported operation." };
  }

  // ==========================================
  // STORE MEMBERS
  // ==========================================
  public evaluateStoreMember(
    ctx: SecurityContext,
    op: DbOperation,
    row: MockStoreMember,
    oldRow?: MockStoreMember,
  ): RlsEvaluationResult {
    const storeId = row.store_id;

    if (op === "SELECT") {
      if (ctx.userId === row.user_id || isStoreAdmin(ctx, storeId)) {
        return { allowed: true };
      }
      return { allowed: false, reason: "Access denied: cannot view other store members." };
    }

    if (op === "INSERT") {
      if (!isStoreAdmin(ctx, storeId)) {
        return { allowed: false, reason: "Only Store Admins can add store members." };
      }
      // Only owner can assign owner role
      if (row.role === "owner" && !isStoreOwner(ctx, storeId)) {
        return { allowed: false, reason: "Only the Store Owner can assign the owner role." };
      }
      return { allowed: true };
    }

    if (op === "UPDATE") {
      if (!oldRow) return { allowed: false, reason: "Old row state required." };
      if (row.store_id !== oldRow.store_id || row.user_id !== oldRow.user_id) {
        return { allowed: false, reason: "Store and user references are immutable." };
      }
      // Modifying owner role requires owner role
      if (
        (oldRow.role === "owner" || row.role === "owner") &&
        !isStoreOwner(ctx, oldRow.store_id)
      ) {
        return {
          allowed: false,
          reason: "Only the Store Owner can modify or transfer the owner role.",
        };
      }
      if (!isStoreAdmin(ctx, oldRow.store_id)) {
        return { allowed: false, reason: "Only Store Admins can update team roles." };
      }
      return { allowed: true };
    }

    if (op === "DELETE") {
      // Member leaving own non-owner role
      if (ctx.userId === row.user_id && row.role !== "owner") {
        return { allowed: true };
      }
      // Owner cannot be deleted by an admin
      if (row.role === "owner") {
        return { allowed: false, reason: "Cannot delete the store owner." };
      }
      if (!isStoreAdmin(ctx, storeId)) {
        return { allowed: false, reason: "Only Store Admins can remove team members." };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: "Unsupported operation." };
  }

  // ==========================================
  // STORE SETTINGS
  // ==========================================
  public evaluateStoreSettings(
    ctx: SecurityContext,
    op: DbOperation,
    row: { store_id: string; [key: string]: unknown },
    oldRow?: { store_id: string; [key: string]: unknown },
    isPublicView = false,
  ): RlsEvaluationResult {
    const storeId = row.store_id;

    if (op === "SELECT") {
      if (isPublicView) {
        // Public view is accessible if store is active
        const store = this.stores.get(storeId);
        if (store && store.status === "active") {
          return { allowed: true };
        }
        return { allowed: false, reason: "Public view only exposes active stores." };
      }

      if (isStoreMember(ctx, storeId)) {
        return { allowed: true };
      }
      return { allowed: false, reason: "Access denied: actor is not a member of this store." };
    }

    if (op === "INSERT") {
      if (!isStoreAdmin(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Access denied: only Store Admins can create settings for this store.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    if (op === "UPDATE") {
      if (!oldRow) return { allowed: false, reason: "Old row state required." };
      if (row.store_id !== oldRow.store_id) {
        return {
          allowed: false,
          reason: "Cross-tenant mutation forbidden: store_id cannot be changed.",
          violatingField: "store_id",
        };
      }
      if (!isStoreAdmin(ctx, oldRow.store_id)) {
        return {
          allowed: false,
          reason: "Access denied: only Store Admins can update settings for this store.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    if (op === "DELETE") {
      if (!isStoreOwner(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Access denied: only Store Owners can delete store settings.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: "Unsupported operation." };
  }

  // ==========================================
  // STORE ASSETS METADATA
  // ==========================================
  public evaluateStoreAsset(
    ctx: SecurityContext,
    op: DbOperation,
    row: { store_id: string; visibility?: string; [key: string]: unknown },
    oldRow?: { store_id: string; [key: string]: unknown },
  ): RlsEvaluationResult {
    const storeId = row.store_id;

    if (op === "SELECT") {
      const isPublic = row.visibility === "public";
      if (isPublic && this.isStoreActive(storeId)) {
        return { allowed: true };
      }
      if (isStoreMember(ctx, storeId) || isSuperAdmin(ctx)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: "Access denied: private store asset requires store membership.",
      };
    }

    if (op === "INSERT") {
      if (!isStoreEditor(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Access denied: only Store Editors can register asset metadata for this store.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    if (op === "UPDATE") {
      if (!oldRow) return { allowed: false, reason: "Old row state required." };
      if (row.store_id !== oldRow.store_id) {
        return {
          allowed: false,
          reason: "Cross-tenant mutation forbidden: store_id cannot be changed.",
          violatingField: "store_id",
        };
      }
      if (!isStoreAdmin(ctx, oldRow.store_id)) {
        return {
          allowed: false,
          reason: "Access denied: only Store Admins can update asset metadata for this store.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    if (op === "DELETE") {
      if (!isStoreAdmin(ctx, storeId)) {
        return {
          allowed: false,
          reason: "Access denied: only Store Admins can delete asset metadata for this store.",
          violatingField: "store_id",
        };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: "Unsupported operation." };
  }
}
