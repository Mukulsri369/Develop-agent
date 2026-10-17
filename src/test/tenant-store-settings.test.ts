import { describe, expect, it } from "vitest";
import {
  StoreSettingsService,
  sanitizePublicStoreSettings,
  normalizeStoreSettings,
} from "@/platform/settings/service";
import {
  DEFAULT_ASTRONOMY_STORE_SETTINGS,
  DEFAULT_TENANT_STORE_SETTINGS,
} from "@/platform/settings/constants";
import type { StoreSettings } from "@/platform/settings/types";
import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";
import { resolveStoreIdentity } from "@/platform/identity";
import {
  RlsPolicyEngine,
  type MockStore,
  type MockStoreMember,
} from "@/platform/security/rls-policy-engine";
import type { SecurityContext } from "@/platform/security/types";

describe("Tenant-Specific Store Settings and Brand Configuration", () => {
  describe("1. Tenant 0 Preservation (Our Visible Universe)", () => {
    it("preserves authoritative astronomy brand identity for Tenant 0", () => {
      const tenant0 = normalizeStoreSettings(LEGACY_STORE_ID, null);

      expect(tenant0.store_id).toBe(LEGACY_STORE_ID);
      expect(tenant0.store_name).toBe("Our Visible Universe");
      expect(tenant0.business_category).toBe("astronomy");
      expect(tenant0.tagline).toBe("Explore the universe. Discover something extraordinary.");
      expect(tenant0.affiliate_disclosure).toContain("Our Visible Universe");
      expect(tenant0.feature_flags.enable_galaxy_background).toBe(true);
      expect(tenant0.promotions.festival_special?.title).toBe("Cosmic Festival Special");
      expect(tenant0.about_content.title).toBe("About the store");
    });

    it("resolves store identity correctly with astronomy fallback", () => {
      const publicSettings = sanitizePublicStoreSettings(DEFAULT_ASTRONOMY_STORE_SETTINGS);
      const identity = resolveStoreIdentity(publicSettings);

      expect(identity.storeName).toBe("Our Visible Universe");
      expect(identity.tagline).toBe("Explore the universe. Discover something extraordinary.");
      expect(identity.themeId).toBe("astronomy");
      expect(identity.footerText).toBe("Explore the universe. Discover something extraordinary.");
    });
  });

  describe("2. Multi-Tenant Store Settings Isolation", () => {
    const storeAId = "11111111-1111-1111-1111-111111111111";
    const storeBId = "22222222-2222-2222-2222-222222222222";

    const storeASettings: Partial<StoreSettings> = {
      store_id: storeAId,
      store_name: "Aurora Nordic Living",
      tagline: "Minimalist Scandinavian design & cozy home essentials.",
      business_category: "home_decor",
      currency: "EUR",
      default_locale: "sv-SE",
      instagram_url: "https://instagram.com/auroranordic",
      affiliate_disclosure: "Aurora participates in home decor affiliate programs.",
      footer_text: "Nordic warmth for modern interiors.",
      feature_flags: {
        enable_galaxy_background: false,
        enable_festival: false,
        enable_spotlights: true,
      },
    };

    const storeBSettings: Partial<StoreSettings> = {
      store_id: storeBId,
      store_name: "Apex Gaming & Tech",
      tagline: "Next-generation gaming rigs, gear and peripherals.",
      business_category: "gaming",
      currency: "USD",
      default_locale: "en-US",
      youtube_url: "https://youtube.com/@apexgaming",
      affiliate_disclosure: "Apex earns commissions on PC hardware links.",
      footer_text: "Level up your gaming setup.",
      feature_flags: {
        enable_galaxy_background: false,
        enable_festival: true,
        enable_spotlights: false,
      },
    };

    it("normalizes Store A and Store B with independent identities and currencies", () => {
      const normalizedA = normalizeStoreSettings(storeAId, storeASettings);
      const normalizedB = normalizeStoreSettings(storeBId, storeBSettings);

      expect(normalizedA.store_name).toBe("Aurora Nordic Living");
      expect(normalizedA.currency).toBe("EUR");
      expect(normalizedA.business_category).toBe("home_decor");
      expect(normalizedA.feature_flags.enable_galaxy_background).toBe(false);

      expect(normalizedB.store_name).toBe("Apex Gaming & Tech");
      expect(normalizedB.currency).toBe("USD");
      expect(normalizedB.business_category).toBe("gaming");
      expect(normalizedB.youtube_url).toBe("https://youtube.com/@apexgaming");

      // Verify no cross-pollution
      expect(normalizedA.youtube_url).toBeNull();
      expect(normalizedB.instagram_url).toBeNull();
      expect(normalizedA.store_name).not.toBe(normalizedB.store_name);
    });

    it("resolves store identity independently for different tenants", () => {
      const publicA = sanitizePublicStoreSettings(normalizeStoreSettings(storeAId, storeASettings));
      const publicB = sanitizePublicStoreSettings(normalizeStoreSettings(storeBId, storeBSettings));

      const identityA = resolveStoreIdentity(publicA);
      const identityB = resolveStoreIdentity(publicB);

      expect(identityA.storeName).toBe("Aurora Nordic Living");
      expect(identityA.tagline).toBe("Minimalist Scandinavian design & cozy home essentials.");

      expect(identityB.storeName).toBe("Apex Gaming & Tech");
      expect(identityB.tagline).toBe("Next-generation gaming rigs, gear and peripherals.");
    });
  });

  describe("3. Public Sanitization and Security Safeguards", () => {
    it("strips private contact email and support email from public settings", () => {
      const privateSettings: StoreSettings = {
        ...DEFAULT_ASTRONOMY_STORE_SETTINGS,
        store_id: "test-store",
        contact_email: "secret.owner@example.com",
        support_email: "internal.support@example.com",
        support_url: "https://support.example.com",
        contact_details: {
          phone: "+1-555-0199",
          supportHours: "9am - 5pm",
        },
      };

      const sanitized = sanitizePublicStoreSettings(privateSettings);

      // TypeScript compile-time & runtime verification
      const record = sanitized as unknown as Record<string, unknown>;
      expect(record.contact_email).toBeUndefined();
      expect(record.support_email).toBeUndefined();
      expect(sanitized.support_url).toBe("https://support.example.com");
      expect(sanitized.contact_details.phone).toBe("+1-555-0199");
    });
  });

  describe("4. RLS Policy Enforcement and Cross-Tenant Protection", () => {
    const storeAId = "11111111-1111-1111-1111-111111111111";
    const storeBId = "22222222-2222-2222-2222-222222222222";

    const mockStores: MockStore[] = [
      { id: storeAId, name: "Store A", owner_id: "user-owner-a", status: "active" },
      { id: storeBId, name: "Store B", owner_id: "user-owner-b", status: "active" },
    ];

    const mockMembers: MockStoreMember[] = [
      {
        id: "m1",
        store_id: storeAId,
        user_id: "user-admin-a",
        role: "admin",
        membership_status: "active",
      },
      {
        id: "m2",
        store_id: storeAId,
        user_id: "user-editor-a",
        role: "editor",
        membership_status: "active",
      },
      {
        id: "m3",
        store_id: storeBId,
        user_id: "user-admin-b",
        role: "admin",
        membership_status: "active",
      },
    ];

    const engine = new RlsPolicyEngine();
    mockStores.forEach((s) => engine.registerStore(s));

    const adminAContext: SecurityContext = {
      userId: "user-admin-a",
      role: "admin",
      isSuperAdmin: false,
      storeMemberships: [{ storeId: storeAId, role: "admin", status: "active" }],
    };

    const editorAContext: SecurityContext = {
      userId: "user-editor-a",
      role: "editor",
      isSuperAdmin: false,
      storeMemberships: [{ storeId: storeAId, role: "editor", status: "active" }],
    };

    const visitorContext: SecurityContext = {
      userId: null,
      role: "anon",
      isSuperAdmin: false,
      storeMemberships: [],
    };

    it("allows public visitors to view public settings of active stores", () => {
      const res = engine.evaluateStoreSettings(
        visitorContext,
        "SELECT",
        { store_id: storeAId },
        undefined,
        true, // isPublicView
      );
      expect(res.allowed).toBe(true);
    });

    it("blocks public visitors from reading private store_settings table directly", () => {
      const res = engine.evaluateStoreSettings(
        visitorContext,
        "SELECT",
        { store_id: storeAId },
        undefined,
        false, // direct private table read
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Access denied: actor is not a member of this store.");
    });

    it("allows Store A Admin to update Store A settings", () => {
      const res = engine.evaluateStoreSettings(
        adminAContext,
        "UPDATE",
        { store_id: storeAId, store_name: "Updated Store A" },
        { store_id: storeAId, store_name: "Store A" },
      );
      expect(res.allowed).toBe(true);
    });

    it("strictly blocks Store A Admin from updating Store B settings (cross-tenant)", () => {
      const res = engine.evaluateStoreSettings(
        adminAContext,
        "UPDATE",
        { store_id: storeBId, store_name: "Hacked Store B" },
        { store_id: storeBId, store_name: "Store B" },
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain(
        "Access denied: only Store Admins can update settings for this store.",
      );
      expect(res.violatingField).toBe("store_id");
    });

    it("blocks Store Editor from updating store settings (role privilege boundary)", () => {
      const res = engine.evaluateStoreSettings(
        editorAContext,
        "UPDATE",
        { store_id: storeAId, store_name: "Unauthorized Change" },
        { store_id: storeAId, store_name: "Store A" },
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain(
        "Access denied: only Store Admins can update settings for this store.",
      );
    });

    it("strictly forbids mutating store_id during update (anti-tampering)", () => {
      const res = engine.evaluateStoreSettings(
        adminAContext,
        "UPDATE",
        { store_id: storeBId, store_name: "Attempted Reassignment" },
        { store_id: storeAId, store_name: "Store A" },
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cross-tenant mutation forbidden: store_id cannot be changed.");
      expect(res.violatingField).toBe("store_id");
    });
  });

  describe("5. Promotional & Retailer Configuration", () => {
    it("supports custom promotional campaigns and holiday specials", () => {
      const tenantWithPromo = normalizeStoreSettings("promo-store", {
        promotions: {
          bannerEnabled: true,
          bannerText: "Black Friday Sale: Up to 40% Off Select Telescope Optics!",
          bannerLink: "/category/astronomy-telescopes",
          festival_special: {
            enabled: true,
            title: "Winter Solstice Stargazing",
            eyebrow: "Seasonal Special",
            description: "Best equipment for long winter night observations.",
            product_ids: ["p1", "p2"],
          },
          category_spotlights: {
            "cat-telescopes": "prod-celestron",
          },
        },
      });

      expect(tenantWithPromo.promotions.bannerEnabled).toBe(true);
      expect(tenantWithPromo.promotions.bannerText).toContain("Black Friday");
      expect(tenantWithPromo.promotions.festival_special?.product_ids).toHaveLength(2);
      expect(tenantWithPromo.promotions.category_spotlights?.["cat-telescopes"]).toBe(
        "prod-celestron",
      );
    });

    it("supports custom retailer affiliate configurations", () => {
      const tenantRetailers = normalizeStoreSettings("custom-retailer-store", {
        supported_retailers: [
          {
            name: "BestBuy",
            code: "bestbuy",
            trackingId: "bb-associate-123",
            tagParam: "aid",
            enabled: true,
          },
        ],
        affiliate_config: {
          defaultRetailer: "bestbuy",
          supportedRetailers: [],
          amazonAssociateTag: null,
          flipkartAffiliateId: null,
          outboundTrackingEnabled: true,
          commissionNotice: "BestBuy affiliate program participant.",
        },
      });

      expect(tenantRetailers.supported_retailers).toHaveLength(1);
      expect(tenantRetailers.supported_retailers[0].name).toBe("BestBuy");
      expect(tenantRetailers.affiliate_config.defaultRetailer).toBe("bestbuy");
    });
  });
});
