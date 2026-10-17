/**
 * Universal commerce data contracts.
 * These interfaces decouple presentation components from raw database table definitions.
 */

export interface BaseProduct {
  id: string;
  name: string;
  slug: string;
  price: number | null;
  currency: string;
  featured: boolean;
  active: boolean;
}

export interface CommerceProductCard extends BaseProduct {
  imageUrl: string | null;
  imageAlt: string | null;
  brand: string | null;
  shortDescription: string | null;
  categoryIds: string[];
  retailer: string | null;
  affiliateUrl: string | null;
}

export interface CommerceCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  active: boolean;
  sortOrder: number;
}
