/**
 * Multi-Tenant Commerce Types & Entity Contracts
 */

export interface StoreScopedCategory {
  id: string;
  store_id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StoreScopedProduct {
  id: string;
  store_id: string;
  name: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  brand: string | null;
  subcategory: string | null;
  category_id: string | null;
  category_ids: string[];
  affiliate_url: string | null;
  amazon_url: string | null;
  amazon_asin: string | null;
  amazon_marketplace: string | null;
  retailer: string | null;
  retailer_product_id: string | null;
  price: number | null;
  currency: string | null;
  price_updated_at: string | null;
  featured: boolean;
  active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoreProductImage {
  id: string;
  product_id: string;
  image_url: string;
  storage_path: string | null;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
}

export interface StoreProductFeature {
  id: string;
  product_id: string;
  feature: string;
  sort_order: number;
}

export interface StoreProductTag {
  id: string;
  product_id: string;
  tag: string;
}

export interface StoreScopedOutboundClick {
  id: string;
  store_id: string;
  product_id: string;
  created_at: string;
}

export interface CommerceMigrationAudit {
  productsTotal: number;
  productsBackfilled: number;
  categoriesTotal: number;
  categoriesBackfilled: number;
  clicksTotal: number;
  clicksBackfilled: number;
  orphanedCategoriesCount: number;
  orphanedImagesCount: number;
  crossStoreCategoryViolations: number;
  duplicateAffiliateUrlViolations: number;
  success: boolean;
}
