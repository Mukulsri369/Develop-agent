import type { CommerceProductCard } from "./types";
import type { ProductCardData } from "@/lib/store";

/**
 * Normalizes a legacy ProductCardData or database row into a standardized CommerceProductCard.
 */
export function normalizeProductCard(p: ProductCardData): CommerceProductCard {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    price: p.price,
    currency: p.currency || "USD",
    featured: Boolean(p.featured),
    active: true,
    imageUrl: p.image_url,
    imageAlt: p.image_alt,
    brand: p.brand,
    shortDescription: p.short_description,
    categoryIds:
      p.category_ids && p.category_ids.length > 0
        ? p.category_ids
        : p.category_id
          ? [p.category_id]
          : [],
    retailer: p.retailer,
    affiliateUrl: p.affiliate_url,
  };
}
