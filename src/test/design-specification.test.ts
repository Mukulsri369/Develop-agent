import { describe, expect, it } from "vitest";
import {
  UniversalStorefrontSpecSchema,
  type UniversalStorefrontSpec,
} from "@/storefront/design/schema";

describe("Universal Storefront Specification schema validation", () => {
  const validSpec: UniversalStorefrontSpec = {
    schemaVersion: "1.0.0",
    brand: {
      storeName: "Aura Streetwear",
      tagline: "High-contrast urban gear",
      description: "Curated streetwear and sneakers.",
      industry: "streetwear_sneakers",
      personality: "neo_brutalist",
      colors: {
        primary: "#10B981",
        primaryForeground: "#000000",
        secondary: "#18181B",
        secondaryForeground: "#FAFAFA",
        background: "#09090B",
        foreground: "#FAFAFA",
        card: "#18181B",
        cardForeground: "#FAFAFA",
        muted: "#27272A",
        mutedForeground: "#A1A1AA",
        accent: "#34D399",
        border: "#27272A",
        ring: "#10B981",
      },
      typography: {
        headingFont: "Syne",
        bodyFont: "Plus Jakarta Sans",
        monoFont: "JetBrains Mono",
        headingWeight: "bold",
        letterSpacing: "tight",
      },
      cornerStyle: "sharp",
    },
    sections: [
      {
        id: "hero-1",
        type: "editorial_hero",
        visible: true,
        order: 1,
        headline: "Drop 01: Concrete Monolith",
        subheadline: "Limited release technical apparel.",
      },
      {
        id: "rail-1",
        type: "featured_products_rail",
        visible: true,
        order: 2,
        headline: "Selected Drops",
        contentBinding: {
          source: "featured_products",
          limit: 6,
        },
      },
    ],
    animations: {
      motionIntensity: "high",
      scrollParallax: true,
      cardHoverElevation: true,
    },
    seo: {
      titleTemplate: "%s | Aura Streetwear",
      metaDescription: "Exclusive streetwear and technical fashion drops.",
      keywords: ["streetwear", "sneakers", "urban fashion"],
    },
  };

  it("successfully parses and validates a conforming specification", () => {
    const result = UniversalStorefrontSpecSchema.safeParse(validSpec);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid schema version", () => {
    const invalid = { ...validSpec, schemaVersion: "2.0.0" };
    const result = UniversalStorefrontSpecSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects unknown or unapproved section types", () => {
    const invalid = {
      ...validSpec,
      sections: [
        {
          id: "bad-sec",
          type: "arbitrary_custom_unapproved_script_injection",
          visible: true,
          order: 1,
        },
      ],
    };
    const result = UniversalStorefrontSpecSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects specs missing sections", () => {
    const invalid = { ...validSpec, sections: [] };
    const result = UniversalStorefrontSpecSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
