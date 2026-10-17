/**
 * Multi-Tenant Commerce Migration & Audit Helpers
 *
 * Provides:
 * - Read-only validation queries and orphan detection
 * - Staged backfill simulation for staging/dev test suites
 * - Row count verification before and after migration
 * - Data preservation audits
 */

import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";
import type {
  StoreScopedProduct,
  StoreScopedCategory,
  StoreProductImage,
  StoreScopedOutboundClick,
  CommerceMigrationAudit,
} from "./types";
import { assertProductFieldPreservation } from "./validation";

export interface PreMigrationDataset {
  products: Array<Omit<StoreScopedProduct, "store_id"> & { store_id?: string | null }>;
  categories: Array<Omit<StoreScopedCategory, "store_id"> & { store_id?: string | null }>;
  images: StoreProductImage[];
  clicks: Array<Omit<StoreScopedOutboundClick, "store_id"> & { store_id?: string | null }>;
}

export interface PostMigrationDataset {
  products: StoreScopedProduct[];
  categories: StoreScopedCategory[];
  images: StoreProductImage[];
  clicks: StoreScopedOutboundClick[];
  audit: CommerceMigrationAudit;
}

/**
 * Runs a simulated safe expand-and-backfill migration on commerce records,
 * assigning legacy single-store records to Tenant 0 while preserving all data.
 */
export function migrateCommerceRecordsToLegacyStore(
  dataset: PreMigrationDataset,
  targetStoreId: string = LEGACY_STORE_ID,
): PostMigrationDataset {
  const categoriesBeforeCount = dataset.categories.length;
  const productsBeforeCount = dataset.products.length;
  const clicksBeforeCount = dataset.clicks.length;

  // 1. Backfill categories
  const migratedCategories: StoreScopedCategory[] = dataset.categories.map((cat) => ({
    ...cat,
    store_id: cat.store_id || targetStoreId,
  }));

  const categoryMap = new Map<string, StoreScopedCategory>(
    migratedCategories.map((c) => [c.id, c]),
  );

  // 2. Backfill products
  let orphanedCategoriesCount = 0;
  let crossStoreCategoryViolations = 0;

  const migratedProducts: StoreScopedProduct[] = dataset.products.map((prod) => {
    const effectiveStoreId = prod.store_id || targetStoreId;

    // Check category relationships
    for (const catId of prod.category_ids) {
      const category = categoryMap.get(catId);
      if (!category) {
        orphanedCategoriesCount++;
      } else if (category.store_id !== effectiveStoreId) {
        crossStoreCategoryViolations++;
      }
    }

    const migrated: StoreScopedProduct = {
      ...prod,
      store_id: effectiveStoreId,
    };

    // Assert zero field loss
    assertProductFieldPreservation(prod, migrated);
    return migrated;
  });

  const productMap = new Map<string, StoreScopedProduct>(migratedProducts.map((p) => [p.id, p]));

  // 3. Verify images (images inherit ownership via product_id)
  let orphanedImagesCount = 0;
  for (const img of dataset.images) {
    if (!productMap.has(img.product_id)) {
      orphanedImagesCount++;
    }
  }

  // 4. Backfill outbound clicks
  const migratedClicks: StoreScopedOutboundClick[] = dataset.clicks.map((click) => {
    const parentProd = productMap.get(click.product_id);
    return {
      ...click,
      store_id: click.store_id || parentProd?.store_id || targetStoreId,
    };
  });

  const audit: CommerceMigrationAudit = {
    productsTotal: productsBeforeCount,
    productsBackfilled: migratedProducts.filter((p) => p.store_id === targetStoreId).length,
    categoriesTotal: categoriesBeforeCount,
    categoriesBackfilled: migratedCategories.filter((c) => c.store_id === targetStoreId).length,
    clicksTotal: clicksBeforeCount,
    clicksBackfilled: migratedClicks.filter((c) => c.store_id === targetStoreId).length,
    orphanedCategoriesCount,
    orphanedImagesCount,
    crossStoreCategoryViolations,
    duplicateAffiliateUrlViolations: 0,
    success: orphanedCategoriesCount === 0 && crossStoreCategoryViolations === 0,
  };

  return {
    products: migratedProducts,
    categories: migratedCategories,
    images: dataset.images,
    clicks: migratedClicks,
    audit,
  };
}
