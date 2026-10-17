import { describe, expect, it } from "vitest";
import { normalizeProductCard } from "@/commerce/normalizer";
import type { ProductCardData } from "@/lib/store";

describe("Commerce Data Normalizer", () => {
  it("normalizes a complete product record", () => {
    const raw: ProductCardData = {
      id: "prod-1",
      name: "Celestron NexStar 8SE",
      slug: "celestron-nexstar-8se",
      price: 1599,
      currency: "USD",
      featured: true,
      image_url: "https://example.com/scope.webp",
      image_alt: "Celestron Telescope",
      brand: "Celestron",
      short_description: "Computerized Schmidt-Cassegrain telescope.",
      category_id: "cat-1",
      category_ids: ["cat-1", "cat-2"],
      retailer: "Amazon",
      affiliate_url: "https://amazon.com/dp/B000GUFOC8?tag=test-20",
    };

    const normalized = normalizeProductCard(raw);
    expect(normalized.id).toBe("prod-1");
    expect(normalized.name).toBe("Celestron NexStar 8SE");
    expect(normalized.price).toBe(1599);
    expect(normalized.currency).toBe("USD");
    expect(normalized.categoryIds).toEqual(["cat-1", "cat-2"]);
    expect(normalized.affiliateUrl).toBe("https://amazon.com/dp/B000GUFOC8?tag=test-20");
  });

  it("handles legacy single-category records gracefully", () => {
    const legacy: ProductCardData = {
      id: "prod-2",
      name: "Moon Lamp",
      slug: "moon-lamp",
      price: 49,
      currency: "INR",
      featured: false,
      image_url: null,
      image_alt: null,
      brand: null,
      short_description: null,
      category_id: "cat-lights",
      category_ids: [],
      retailer: "Flipkart",
      affiliate_url: "https://flipkart.com/lamp",
    };

    const normalized = normalizeProductCard(legacy);
    expect(normalized.categoryIds).toEqual(["cat-lights"]);
  });
});
