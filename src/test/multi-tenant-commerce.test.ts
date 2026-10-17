import { describe, expect, it } from "vitest";
import {
  checkStoreScopedSlugUniqueness,
  checkStoreScopedAffiliateUrlUniqueness,
  validateCrossStoreCategoryAssignment,
  assertProductFieldPreservation,
  CrossStoreRelationalError,
} from "@/platform/commerce/validation";
import {
  migrateCommerceRecordsToLegacyStore,
  type PreMigrationDataset,
} from "@/platform/commerce/migration-helper";
import type {
  StoreScopedCategory,
  StoreScopedProduct,
  StoreProductImage,
} from "@/platform/commerce/types";
import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";

describe("Multi-Tenant Commerce — Three Representative Stores Setup", () => {
  const storeAstronomy = LEGACY_STORE_ID;
  const storeFashion = "store-fashion-222";
  const storeFootwear = "store-footwear-333";

  const categories: StoreScopedCategory[] = [
    {
      id: "cat-astro-telescopes",
      store_id: storeAstronomy,
      name: "Telescopes",
      slug: "telescopes",
      description: "Stargazing gear",
      image_url: null,
      active: true,
      sort_order: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "cat-fashion-apparel",
      store_id: storeFashion,
      name: "Apparel",
      slug: "apparel",
      description: "Urban fashion",
      image_url: null,
      active: true,
      sort_order: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "cat-footwear-sneakers",
      store_id: storeFootwear,
      name: "Sneakers",
      slug: "sneakers",
      description: "Performance footwear",
      image_url: null,
      active: true,
      sort_order: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ];

  it("permits identical product slugs across different stores", () => {
    const existingProducts = [
      { id: "prod-1", store_id: storeFashion, slug: "running-shoes" },
      { id: "prod-2", store_id: storeAstronomy, slug: "space-hoodie" },
    ];

    // Footwear store can also create 'running-shoes' without conflict
    const res = checkStoreScopedSlugUniqueness({
      candidateSlug: "running-shoes",
      storeId: storeFootwear,
      existingItems: existingProducts,
    });
    expect(res.isUnique).toBe(true);

    // Fashion store can also create 'space-hoodie' without conflict
    const res2 = checkStoreScopedSlugUniqueness({
      candidateSlug: "space-hoodie",
      storeId: storeFashion,
      existingItems: existingProducts,
    });
    expect(res2.isUnique).toBe(true);
  });

  it("rejects duplicate product slugs within the same store", () => {
    const existingProducts = [
      { id: "prod-1", store_id: storeFashion, slug: "running-shoes" },
      { id: "prod-2", store_id: storeFashion, slug: "vintage-denim" },
    ];

    expect(() =>
      checkStoreScopedSlugUniqueness({
        candidateSlug: "running-shoes",
        storeId: storeFashion,
        existingItems: existingProducts,
      }),
    ).toThrow(/DUPLICATE_STORE_SLUG/);
  });

  it("allows self-edits with identical slug within the same store", () => {
    const existingProducts = [{ id: "prod-1", store_id: storeFashion, slug: "running-shoes" }];

    const res = checkStoreScopedSlugUniqueness({
      candidateSlug: "running-shoes",
      storeId: storeFashion,
      existingItems: existingProducts,
      currentId: "prod-1",
    });
    expect(res.isUnique).toBe(true);
  });

  it("permits identical category slugs across different stores but rejects duplicates within same store", () => {
    const existingCategories = [
      { id: "cat-1", store_id: storeFashion, slug: "featured" },
      { id: "cat-2", store_id: storeFootwear, slug: "featured" },
    ];

    // Astronomy store can also use 'featured'
    expect(
      checkStoreScopedSlugUniqueness({
        candidateSlug: "featured",
        storeId: storeAstronomy,
        existingItems: existingCategories,
      }).isUnique,
    ).toBe(true);

    // Fashion store cannot add another 'featured'
    expect(() =>
      checkStoreScopedSlugUniqueness({
        candidateSlug: "featured",
        storeId: storeFashion,
        existingItems: existingCategories,
      }),
    ).toThrow(/DUPLICATE_STORE_SLUG/);
  });

  it("blocks cross-store category assignments strictly", () => {
    // Attempt to assign Astronomy telescope category to a Fashion product
    expect(() =>
      validateCrossStoreCategoryAssignment({
        productStoreId: storeFashion,
        assignedCategoryIds: ["cat-astro-telescopes"],
        availableCategories: categories,
      }),
    ).toThrow(/Cross-store category assignment forbidden/);
  });

  it("validates multi-category array against store boundaries", () => {
    // Valid: assigning category belonging to Fashion store
    const valid = validateCrossStoreCategoryAssignment({
      productStoreId: storeFashion,
      assignedCategoryIds: ["cat-fashion-apparel"],
      availableCategories: categories,
    });
    expect(valid.valid).toBe(true);

    // Invalid: mix of Fashion and Footwear categories
    expect(() =>
      validateCrossStoreCategoryAssignment({
        productStoreId: storeFashion,
        assignedCategoryIds: ["cat-fashion-apparel", "cat-footwear-sneakers"],
        availableCategories: categories,
      }),
    ).toThrow(CrossStoreRelationalError);
  });
});

describe("Multi-Tenant Commerce — Affiliate URL Isolation", () => {
  const storeA = "store-alpha";
  const storeB = "store-beta";
  const sharedAffiliateUrl = "https://amazon.com/dp/B08N5WRWNW?tag=myaffiliate-20";

  it("permits different stores to promote the same affiliate URL", () => {
    const existingProducts = [
      {
        id: "prod-a1",
        store_id: storeA,
        affiliate_url: sharedAffiliateUrl,
        amazon_url: null,
        active: true,
        deleted_at: null,
      },
    ];

    // Store B publishing the exact same affiliate URL is permitted
    const res = checkStoreScopedAffiliateUrlUniqueness({
      candidateUrl: sharedAffiliateUrl,
      storeId: storeB,
      existingProducts,
    });
    expect(res.isUnique).toBe(true);
  });

  it("rejects duplicate active affiliate URLs within the same store", () => {
    const existingProducts = [
      {
        id: "prod-a1",
        store_id: storeA,
        affiliate_url: sharedAffiliateUrl,
        amazon_url: null,
        active: true,
        deleted_at: null,
      },
    ];

    expect(() =>
      checkStoreScopedAffiliateUrlUniqueness({
        candidateUrl: sharedAffiliateUrl,
        storeId: storeA,
        existingProducts,
      }),
    ).toThrow(/DUPLICATE_STORE_AFFILIATE_URL/);
  });

  it("ignores soft-deleted products when checking affiliate URL uniqueness", () => {
    const existingProducts = [
      {
        id: "prod-a1",
        store_id: storeA,
        affiliate_url: sharedAffiliateUrl,
        amazon_url: null,
        active: true,
        deleted_at: "2026-02-01T12:00:00Z", // Soft deleted!
      },
    ];

    // Can publish the same affiliate URL if the older product was deleted
    const res = checkStoreScopedAffiliateUrlUniqueness({
      candidateUrl: sharedAffiliateUrl,
      storeId: storeA,
      existingProducts,
    });
    expect(res.isUnique).toBe(true);
  });
});

describe("Multi-Tenant Commerce — Staged Legacy Migration & Data Integrity", () => {
  it("safely backfills legacy single-store dataset without data loss or corruption", () => {
    const rawDataset: PreMigrationDataset = {
      categories: [
        {
          id: "cat-1",
          name: "Astronomy & Telescopes",
          slug: "astronomy-telescopes",
          description: "Night sky gear",
          image_url: "https://example.com/cat1.jpg",
          active: true,
          sort_order: 1,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      products: [
        {
          id: "prod-1",
          name: "Celestron NexStar 8SE",
          slug: "celestron-nexstar-8se",
          short_description: "Computerized telescope",
          description: "8-inch Schmidt-Cassegrain optical tube",
          brand: "Celestron",
          subcategory: "Schmidt-Cassegrain",
          category_id: "cat-1",
          category_ids: ["cat-1"],
          affiliate_url: "https://amazon.in/dp/B000GUFOC8?tag=ourvisibleuniverse-21",
          amazon_url: "https://amazon.in/dp/B000GUFOC8",
          amazon_asin: "B000GUFOC8",
          amazon_marketplace: "amazon.in",
          retailer: "amazon",
          retailer_product_id: "B000GUFOC8",
          price: 159999,
          currency: "INR",
          price_updated_at: "2026-02-01T00:00:00Z",
          featured: true,
          active: true,
          deleted_at: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "prod-2-deleted",
          name: "Vintage Sky Map",
          slug: "vintage-sky-map",
          short_description: "Old star chart",
          description: "Reprinted star map",
          brand: "OVU",
          subcategory: "Wall Art",
          category_id: "cat-1",
          category_ids: ["cat-1"],
          affiliate_url: "https://amazon.in/dp/B000111222?tag=ourvisibleuniverse-21",
          amazon_url: null,
          amazon_asin: null,
          amazon_marketplace: null,
          retailer: "amazon",
          retailer_product_id: "B000111222",
          price: 999,
          currency: "INR",
          price_updated_at: null,
          featured: false,
          active: false,
          deleted_at: "2026-02-15T00:00:00Z", // Soft deleted
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-02-15T00:00:00Z",
        },
      ],
      images: [
        {
          id: "img-1",
          product_id: "prod-1",
          image_url: "https://example.com/nexstar.webp",
          storage_path: "products/nexstar.webp",
          alt_text: "NexStar Telescope",
          sort_order: 1,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      clicks: [
        {
          id: "click-1",
          product_id: "prod-1",
          created_at: "2026-01-02T00:00:00Z",
        },
      ],
    };

    const result = migrateCommerceRecordsToLegacyStore(rawDataset);

    // 1. Audit passes
    expect(result.audit.success).toBe(true);
    expect(result.audit.productsTotal).toBe(2);
    expect(result.audit.productsBackfilled).toBe(2);
    expect(result.audit.categoriesTotal).toBe(1);
    expect(result.audit.categoriesBackfilled).toBe(1);
    expect(result.audit.clicksTotal).toBe(1);
    expect(result.audit.clicksBackfilled).toBe(1);
    expect(result.audit.orphanedCategoriesCount).toBe(0);
    expect(result.audit.orphanedImagesCount).toBe(0);

    // 2. Verified store_id attached
    expect(result.products[0].store_id).toBe(LEGACY_STORE_ID);
    expect(result.categories[0].store_id).toBe(LEGACY_STORE_ID);
    expect(result.clicks[0].store_id).toBe(LEGACY_STORE_ID);

    // 3. Child images retain correct product parent
    expect(result.images[0].product_id).toBe("prod-1");

    // 4. Soft deletion status preserved
    expect(result.products[1].deleted_at).toBe("2026-02-15T00:00:00Z");
    expect(result.products[1].active).toBe(false);

    // 5. Affiliate URL tracking parameters completely preserved
    expect(result.products[0].affiliate_url).toBe(
      "https://amazon.in/dp/B000GUFOC8?tag=ourvisibleuniverse-21",
    );
  });

  it("detects and flags corrupted fields during migration verification", () => {
    const original: Partial<StoreScopedProduct> = {
      id: "prod-1",
      name: "Original Name",
      price: 100,
      affiliate_url: "https://amazon.com?tag=test",
    };

    const corrupted: StoreScopedProduct = {
      ...original,
      name: "Altered Name", // Corrupted!
    } as StoreScopedProduct;

    expect(() => assertProductFieldPreservation(original, corrupted)).toThrow(
      /PRODUCT_INTEGRITY_VIOLATION/,
    );
  });
});
