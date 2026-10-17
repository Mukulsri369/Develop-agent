/**
 * Multi-Tenant Commerce Relational Validation
 *
 * Enforces:
 * - Store-scoped slug uniqueness (allows identical slugs across different stores)
 * - Cross-store category boundary protection (products cannot reference categories from another store)
 * - Store-scoped affiliate URL duplicate prevention
 * - Preservation of product fields and affiliate tracking parameters
 */

import type { StoreScopedCategory, StoreScopedProduct } from "./types";

export class CrossStoreRelationalError extends Error {
  constructor(
    public readonly code:
      | "CROSS_STORE_CATEGORY_ASSIGNMENT"
      | "DUPLICATE_STORE_SLUG"
      | "DUPLICATE_STORE_AFFILIATE_URL"
      | "PRODUCT_INTEGRITY_VIOLATION",
    message: string,
  ) {
    super(`[Commerce Relational Guard] ${code}: ${message}`);
    this.name = "CrossStoreRelationalError";
  }
}

/**
 * Validates that all category IDs assigned to a product belong strictly to the same store.
 */
export function validateCrossStoreCategoryAssignment(params: {
  productStoreId: string;
  assignedCategoryIds: string[];
  availableCategories: StoreScopedCategory[];
}): { valid: boolean; validatedCategoryIds: string[] } {
  const { productStoreId, assignedCategoryIds, availableCategories } = params;

  const storeCategoryMap = new Map<string, StoreScopedCategory>();
  for (const cat of availableCategories) {
    storeCategoryMap.set(cat.id, cat);
  }

  for (const catId of assignedCategoryIds) {
    const category = storeCategoryMap.get(catId);
    if (!category) {
      throw new CrossStoreRelationalError(
        "CROSS_STORE_CATEGORY_ASSIGNMENT",
        `Category '${catId}' does not exist.`,
      );
    }

    if (category.store_id !== productStoreId) {
      throw new CrossStoreRelationalError(
        "CROSS_STORE_CATEGORY_ASSIGNMENT",
        `Cross-store category assignment forbidden! Product belongs to store '${productStoreId}', but category '${category.name}' (${catId}) belongs to store '${category.store_id}'.`,
      );
    }
  }

  return {
    valid: true,
    validatedCategoryIds: assignedCategoryIds,
  };
}

/**
 * Checks for slug uniqueness scoped strictly within a given store.
 * Allows the same slug across different stores.
 */
export function checkStoreScopedSlugUniqueness(params: {
  candidateSlug: string;
  storeId: string;
  existingItems: Array<{ id: string; store_id: string; slug: string }>;
  currentId?: string;
}): { isUnique: boolean } {
  const { candidateSlug, storeId, existingItems, currentId } = params;
  const normalizedCandidate = candidateSlug.trim().toLowerCase();

  const conflict = existingItems.find(
    (item) =>
      item.store_id === storeId &&
      item.id !== currentId &&
      item.slug.trim().toLowerCase() === normalizedCandidate,
  );

  if (conflict) {
    throw new CrossStoreRelationalError(
      "DUPLICATE_STORE_SLUG",
      `Slug '${candidateSlug}' is already in use by item '${conflict.id}' within store '${storeId}'. Slugs must be unique per store.`,
    );
  }

  return { isUnique: true };
}

/**
 * Checks for affiliate URL uniqueness scoped strictly within a given store.
 * Permits different stores to promote the same affiliate product, but prevents duplicate
 * active listings within the same store.
 */
export function checkStoreScopedAffiliateUrlUniqueness(params: {
  candidateUrl: string;
  storeId: string;
  existingProducts: Array<{
    id: string;
    store_id: string;
    affiliate_url: string | null;
    amazon_url: string | null;
    active: boolean;
    deleted_at: string | null;
  }>;
  currentProductId?: string;
}): { isUnique: boolean } {
  const { candidateUrl, storeId, existingProducts, currentProductId } = params;
  const normalizedCandidate = candidateUrl.trim().toLowerCase();

  const conflict = existingProducts.find((p) => {
    if (p.store_id !== storeId) return false;
    if (p.id === currentProductId) return false;
    if (!p.active || p.deleted_at !== null) return false;

    const effective = (p.affiliate_url || p.amazon_url || "").trim().toLowerCase();
    return effective === normalizedCandidate;
  });

  if (conflict) {
    throw new CrossStoreRelationalError(
      "DUPLICATE_STORE_AFFILIATE_URL",
      `Affiliate URL '${candidateUrl}' is already published by product '${conflict.id}' in store '${storeId}'.`,
    );
  }

  return { isUnique: true };
}

/**
 * Verifies that all required product fields, pricing, and affiliate parameters are preserved during migration.
 */
export function assertProductFieldPreservation(
  before: Partial<StoreScopedProduct>,
  after: StoreScopedProduct,
): void {
  const checkedKeys: Array<keyof StoreScopedProduct> = [
    "id",
    "name",
    "slug",
    "affiliate_url",
    "amazon_url",
    "amazon_asin",
    "amazon_marketplace",
    "retailer",
    "retailer_product_id",
    "price",
    "currency",
    "active",
    "featured",
    "deleted_at",
  ];

  for (const key of checkedKeys) {
    if (before[key] !== undefined && before[key] !== after[key]) {
      throw new CrossStoreRelationalError(
        "PRODUCT_INTEGRITY_VIOLATION",
        `Product field '${String(key)}' was corrupted during migration. Original: '${String(before[key])}', Migrated: '${String(after[key])}'.`,
      );
    }
  }
}
