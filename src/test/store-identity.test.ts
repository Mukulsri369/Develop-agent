import { describe, expect, it } from "vitest";
import { DEFAULT_ASTRONOMY_IDENTITY, resolveStoreIdentity } from "@/platform/identity";

describe("store identity resolution", () => {
  it("provides complete default astronomy identity for Tenant 0", () => {
    expect(DEFAULT_ASTRONOMY_IDENTITY.storeName).toBe("Our Visible Universe");
    expect(DEFAULT_ASTRONOMY_IDENTITY.themeId).toBe("astronomy");
    expect(DEFAULT_ASTRONOMY_IDENTITY.searchPlaceholder).toContain("telescopes");
    expect(DEFAULT_ASTRONOMY_IDENTITY.affiliateDisclosure).toContain("Amazon Associate");
  });

  it("merges dynamic database site_settings over defaults", () => {
    const custom = resolveStoreIdentity({
      store_name: "Cosmic Curiosities",
      logo_url: "https://example.com/logo.webp",
      affiliate_disclosure: "Custom disclosure statement.",
      footer_text: "Custom footer text.",
    });

    expect(custom.storeName).toBe("Cosmic Curiosities");
    expect(custom.logoUrl).toBe("https://example.com/logo.webp");
    expect(custom.affiliateDisclosure).toBe("Custom disclosure statement.");
    expect(custom.footerText).toBe("Custom footer text.");
    // Fallbacks preserved
    expect(custom.searchPlaceholder).toBe(DEFAULT_ASTRONOMY_IDENTITY.searchPlaceholder);
  });

  it("gracefully falls back when database settings are empty or null", () => {
    const fallback = resolveStoreIdentity(null);
    expect(fallback).toEqual(DEFAULT_ASTRONOMY_IDENTITY);
  });
});
