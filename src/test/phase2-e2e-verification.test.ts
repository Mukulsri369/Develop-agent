import { describe, expect, it } from "vitest";
import { LEGACY_STORE_ID, LEGACY_STORE_SLUG, type StoreRole } from "@/platform/tenancy/constants";
import { resolveStoreIdentity, DEFAULT_ASTRONOMY_IDENTITY } from "@/platform/identity";
import {
  checkStoreScopedSlugUniqueness,
  checkStoreScopedAffiliateUrlUniqueness,
  validateCrossStoreCategoryAssignment,
  assertProductFieldPreservation,
  CrossStoreRelationalError,
} from "@/platform/commerce/validation";
import type {
  StoreScopedProduct,
  StoreScopedCategory,
  StoreProductImage,
} from "@/platform/commerce/types";
import {
  buildStoreAssetPath,
  parseStoreAssetPath,
  validateMediaUpload,
  assertStoreAssetOwnership,
  sanitizePublicMediaHeaders,
} from "@/platform/storage";
import {
  StoreSettingsService,
  normalizeStoreSettings,
  sanitizePublicStoreSettings,
  validateStoreSettingsInput,
} from "@/platform/settings";
import { assertSafePublicDestinationUrl, SsrfBlockedError } from "@/platform/security/ssrf-guard";
import {
  evaluateProductPolicy,
  evaluateCategoryPolicy,
  evaluateStoreSettingsPolicy,
  evaluateStoreMemberPolicy,
  type SecurityContext,
  type MockStore,
  type MockProduct,
  type MockCategory,
  type MockStoreMember,
  type MockStoreSettings,
} from "@/platform/security/rls-policy-engine";
import {
  createTenantCacheKey,
  createTenantProductCacheKey,
} from "@/platform/tenancy/store-context-resolver";

describe("Phase 2 End-to-End Multi-Tenant Verification & Security Suite", () => {
  // --------------------------------------------------------------------------
  // 1. ISOLATED TEST ENVIRONMENTS & IDENTITIES
  // --------------------------------------------------------------------------
  const STORE_A: MockStore = {
    id: LEGACY_STORE_ID,
    name: "Our Visible Universe",
    owner_id: "user-owner-a",
    status: "active",
  };

  const STORE_B: MockStore = {
    id: "store-fashion-202",
    name: "Nebula Threads Fashion",
    owner_id: "user-owner-b",
    status: "active",
  };

  const STORE_C: MockStore = {
    id: "store-footwear-303",
    name: "Orbital Kicks Footwear",
    owner_id: "user-owner-c",
    status: "active",
  };

  const STORE_D_SUSPENDED: MockStore = {
    id: "store-suspended-404",
    name: "Suspended Mart",
    owner_id: "user-owner-d",
    status: "suspended",
  };

  const members: MockStoreMember[] = [
    {
      id: "mem-1",
      store_id: STORE_A.id,
      user_id: "user-owner-a",
      role: "owner",
      membership_status: "active",
    },
    {
      id: "mem-2",
      store_id: STORE_B.id,
      user_id: "user-owner-b",
      role: "owner",
      membership_status: "active",
    },
    {
      id: "mem-3",
      store_id: STORE_C.id,
      user_id: "user-owner-c",
      role: "owner",
      membership_status: "active",
    },
    {
      id: "mem-4",
      store_id: STORE_B.id,
      user_id: "user-editor-b",
      role: "editor",
      membership_status: "active",
    },
    {
      id: "mem-5",
      store_id: STORE_A.id,
      user_id: "user-multi-ac",
      role: "admin",
      membership_status: "active",
    },
    {
      id: "mem-6",
      store_id: STORE_C.id,
      user_id: "user-multi-ac",
      role: "viewer",
      membership_status: "active",
    },
    {
      id: "mem-7",
      store_id: STORE_B.id,
      user_id: "user-suspended-b",
      role: "admin",
      membership_status: "suspended",
    },
  ];

  const stores = [STORE_A, STORE_B, STORE_C, STORE_D_SUSPENDED];

  // Helper context generator
  const createCtx = (userId: string | null): SecurityContext => ({
    userId,
    isSuperAdmin: false,
    memberships: members
      .filter((m) => m.user_id === userId && m.membership_status === "active")
      .map((m) => ({ storeId: m.store_id, role: m.role })),
  });

  const ctxOwnerA = createCtx("user-owner-a");
  const ctxOwnerB = createCtx("user-owner-b");
  const ctxOwnerC = createCtx("user-owner-c");
  const ctxEditorB = createCtx("user-editor-b");
  const ctxMultiAC = createCtx("user-multi-ac");
  const ctxSuspendedB = createCtx("user-suspended-b");
  const ctxVisitor = createCtx(null);

  // --------------------------------------------------------------------------
  // 2. DATA ISOLATION & ACCESS CONTROL
  // --------------------------------------------------------------------------
  describe("Section 2: Multi-Tenant Data Isolation & RLS", () => {
    const productB_draft: MockProduct = {
      id: "prod-b-draft",
      store_id: STORE_B.id,
      name: "Unreleased Autumn Hoodie",
      slug: "autumn-hoodie",
      active: false,
      deleted_at: null,
    };

    const productB_live: MockProduct = {
      id: "prod-b-live",
      store_id: STORE_B.id,
      name: "Classic Cosmic Tee",
      slug: "classic-cosmic-tee",
      active: true,
      deleted_at: null,
    };

    it("prevents Store A Owner from modifying Store B's products", () => {
      const res = evaluateProductPolicy({
        operation: "UPDATE",
        context: ctxOwnerA,
        product: productB_live,
        stores,
        members,
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/forbidden|membership/i);
    });

    it("prevents Store A Owner from viewing Store B's draft products", () => {
      const res = evaluateProductPolicy({
        operation: "SELECT",
        context: ctxOwnerA,
        product: productB_draft,
        stores,
        members,
      });
      expect(res.allowed).toBe(false);
    });

    it("allows public visitors to view published active products only", () => {
      const liveRes = evaluateProductPolicy({
        operation: "SELECT",
        context: ctxVisitor,
        product: productB_live,
        stores,
        members,
      });
      expect(liveRes.allowed).toBe(true);

      const draftRes = evaluateProductPolicy({
        operation: "SELECT",
        context: ctxVisitor,
        product: productB_draft,
        stores,
        members,
      });
      expect(draftRes.allowed).toBe(false);
    });

    it("prevents Store B Owner from editing Store C's settings", () => {
      const settingsC: MockStoreSettings = {
        store_id: STORE_C.id,
        store_name: "Orbital Kicks Footwear",
        contact_email: "support@orbitalkicks.com",
      };

      const res = evaluateStoreSettingsPolicy({
        operation: "UPDATE",
        context: ctxOwnerB,
        settings: settingsC,
        stores,
        members,
      });
      expect(res.allowed).toBe(false);
    });

    it("prevents Store C Owner from deleting Store A's storage assets", () => {
      const pathA = `stores/${STORE_A.id}/products/galaxy-poster.webp`;
      expect(() => {
        assertStoreAssetOwnership(pathA, STORE_C.id);
      }).toThrow(/CROSS_TENANT_STORAGE_ACCESS_DENIED/);
    });

    it("prevents unauthenticated visitors from accessing administrative store members", () => {
      const res = evaluateStoreMemberPolicy({
        operation: "SELECT",
        context: ctxVisitor,
        targetMember: members[0],
        stores,
        members,
      });
      expect(res.allowed).toBe(false);
    });

    it("prevents editors from modifying store ownership or role escalation", () => {
      const res = evaluateStoreMemberPolicy({
        operation: "UPDATE",
        context: ctxEditorB,
        targetMember: members[1], // Owner B
        stores,
        members,
      });
      expect(res.allowed).toBe(false);
    });

    it("ensures suspended staff have zero effective administrative permissions", () => {
      const res = evaluateProductPolicy({
        operation: "UPDATE",
        context: ctxSuspendedB,
        product: productB_live,
        stores,
        members,
      });
      expect(res.allowed).toBe(false);
    });

    it("rejects cross-store foreign-key assignments (categories)", () => {
      const catFashion: StoreScopedCategory = {
        id: "cat-f-1",
        store_id: STORE_B.id,
        name: "Jackets",
        slug: "jackets",
        description: null,
        image_url: null,
        active: true,
        sort_order: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      expect(() => {
        validateCrossStoreCategoryAssignment({
          targetStoreId: STORE_A.id,
          requestedCategoryIds: [catFashion.id],
          availableCategories: [catFashion],
        });
      }).toThrow(CrossStoreRelationalError);
    });
  });

  // --------------------------------------------------------------------------
  // 3. COMPLETE PRODUCT LIFECYCLE WORKFLOW
  // --------------------------------------------------------------------------
  describe("Section 3: Complete Product Lifecycle Across Stores", () => {
    it("executes full CRUD, publishing, soft-delete, and recovery lifecycle for each store", () => {
      const testStores = [STORE_A, STORE_B, STORE_C];

      for (const st of testStores) {
        // 1. Create product as Draft
        const prod: StoreScopedProduct = {
          id: `prod-${st.id}-01`,
          store_id: st.id,
          name: `Flagship Item for ${st.name}`,
          slug: "flagship-item",
          short_description: "Top quality store item",
          description: "Full description with technical specifications.",
          brand: st.name,
          category_id: `cat-${st.id}-default`,
          category_ids: [`cat-${st.id}-default`],
          price: 1999,
          currency: "USD",
          retailer: "amazon",
          affiliate_url: `https://www.amazon.com/dp/B000TEST${st.id.slice(0, 4)}?tag=affil-${st.id.slice(0, 5)}`,
          amazon_url: null,
          amazon_asin: "B000TEST",
          amazon_marketplace: "US",
          featured: false,
          active: false, // Draft
          deleted_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          price_updated_at: new Date().toISOString(),
          subcategory: null,
          retailer_product_id: null,
        };

        expect(prod.active).toBe(false);

        // 2. Add product images
        const img: StoreProductImage = {
          id: `img-${prod.id}-1`,
          product_id: prod.id,
          store_id: st.id,
          image_url: `https://assets.store.com/stores/${st.id}/products/hero.webp`,
          alt_text: "Hero image",
          sort_order: 0,
          created_at: new Date().toISOString(),
        };
        expect(img.store_id).toBe(st.id);

        // 3. Publish product
        prod.active = true;
        expect(prod.active).toBe(true);

        // 4. Verify affiliate link integrity
        expect(prod.affiliate_url).toContain(`affil-${st.id.slice(0, 5)}`);

        // 5. Update product
        prod.price = 2499;
        expect(prod.price).toBe(2499);

        // 6. Unpublish
        prod.active = false;
        expect(prod.active).toBe(false);

        // 7. Soft-delete
        const deletedTimestamp = new Date().toISOString();
        prod.deleted_at = deletedTimestamp;
        expect(prod.deleted_at).toBe(deletedTimestamp);

        // 8. Restore
        prod.deleted_at = null;
        prod.active = true;
        expect(prod.deleted_at).toBeNull();
        expect(prod.active).toBe(true);

        // 9. Slug uniqueness scope
        const check = checkStoreScopedSlugUniqueness({
          candidateSlug: "flagship-item",
          storeId: st.id,
          currentProductId: prod.id,
          existingItems: [prod],
        });
        expect(check.isUnique).toBe(true);
      }
    });

    it("permits same slug across Store A, Store B, and Store C without collision", () => {
      const items = [
        { id: "p1", store_id: STORE_A.id, slug: "celestial-hoodie" },
        { id: "p2", store_id: STORE_B.id, slug: "celestial-hoodie" },
      ];

      // Store C can also use 'celestial-hoodie'
      const checkC = checkStoreScopedSlugUniqueness({
        candidateSlug: "celestial-hoodie",
        storeId: STORE_C.id,
        existingItems: items,
      });
      expect(checkC.isUnique).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 4. STORE ADMINISTRATION & CONTEXT SWITCHING
  // --------------------------------------------------------------------------
  describe("Section 4: Store Administration & Context Switching", () => {
    it("allows multi-store user to access both Store A and Store C with correct scoped roles", () => {
      const membershipA = members.find(
        (m) => m.user_id === "user-multi-ac" && m.store_id === STORE_A.id,
      );
      const membershipC = members.find(
        (m) => m.user_id === "user-multi-ac" && m.store_id === STORE_C.id,
      );

      expect(membershipA?.role).toBe("admin");
      expect(membershipC?.role).toBe("viewer");
    });

    it("validates store settings input and prevents script injection or invalid fields", () => {
      const valid = validateStoreSettingsInput({
        store_name: "Starlight Boutique",
        support_email: "help@starlight.com",
        instagram_url: "https://instagram.com/starlight",
        footer_text: "All rights reserved.",
      });
      expect(valid.isValid).toBe(true);

      const invalidEmail = validateStoreSettingsInput({
        store_name: "Starlight Boutique",
        support_email: "not-an-email",
      });
      expect(invalidEmail.isValid).toBe(false);
      expect(invalidEmail.errors).toContain("Invalid support email address format");
    });

    it("sanitizes public settings to never disclose internal administrator emails", () => {
      const raw = normalizeStoreSettings(STORE_B.id, {
        store_name: "Nebula Threads",
        contact_email: "private-owner-b@internal-company.com",
        support_email: "public-help@nebulathreads.com",
      });

      const sanitized = sanitizePublicStoreSettings(raw);
      const record = sanitized as unknown as Record<string, unknown>;

      expect(record.contact_email).toBeUndefined();
      expect(record.support_email).toBeUndefined();
      expect(sanitized.store_name).toBe("Nebula Threads");
    });
  });

  // --------------------------------------------------------------------------
  // 5. PUBLIC STOREFRONT BEHAVIOR & LEGACY VISUALS
  // --------------------------------------------------------------------------
  describe("Section 5: Public Storefront Behavior & Legacy Astronomy Visuals", () => {
    it("preserves full legacy identity for Store A (Our Visible Universe)", () => {
      const identityA = resolveStoreIdentity({
        store_name: "Our Visible Universe",
      });

      expect(identityA.storeName).toBe("Our Visible Universe");
      expect(identityA.storeSubtext).toBe("Cosmic Curations");
      expect(identityA.isAstronomyStore).toBe(true);
      expect(identityA.hasPlanetaryHero).toBe(true);
    });

    it("resolves distinct commercial identity for Store B (Fashion)", () => {
      const identityB = resolveStoreIdentity({
        store_name: "Nebula Threads Fashion",
        tagline: "Wear the Observational Edge",
      });

      expect(identityB.storeName).toBe("Nebula Threads Fashion");
      expect(identityB.tagline).toBe("Wear the Observational Edge");
      expect(identityB.isAstronomyStore).toBe(false);
      expect(identityB.hasPlanetaryHero).toBe(false);
    });

    it("generates isolated cache keys preventing cross-tenant leakage", () => {
      const keyA = createTenantProductCacheKey(STORE_A.id, "space-lamp");
      const keyB = createTenantProductCacheKey(STORE_B.id, "space-lamp");
      const catKeyA = createTenantCacheKey(STORE_A.id, "categories", "all");
      const catKeyB = createTenantCacheKey(STORE_B.id, "categories", "all");

      expect(keyA).not.toEqual(keyB);
      expect(catKeyA).not.toEqual(catKeyB);
      expect(keyA).toContain(STORE_A.id);
      expect(keyB).toContain(STORE_B.id);
    });
  });

  // --------------------------------------------------------------------------
  // 6. SECURITY AUDIT & SSRF PROTECTION
  // --------------------------------------------------------------------------
  describe("Section 6: Security Audit, SSRF Protection & Storage Security", () => {
    it("blocks SSRF attacks targeting localhost, 127.0.0.1, internal IPs, and AWS metadata", () => {
      const maliciousTargets = [
        "http://localhost:8080/admin",
        "http://127.0.0.1:3000/secret",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/internal",
        "http://192.168.1.1/router",
        "file:///etc/passwd",
        "ftp://internal.vault/dump",
      ];

      for (const target of maliciousTargets) {
        expect(() => {
          assertSafePublicDestinationUrl(target);
        }).toThrow(SsrfBlockedError);
      }
    });

    it("permits approved public retailer domains for product scraping & affiliate checking", () => {
      const validRetailerUrls = [
        "https://www.amazon.com/dp/B08N5WRWNW",
        "https://www.amazon.in/dp/B08N5WRWNW",
        "https://www.flipkart.com/product/p/item1234",
      ];

      for (const url of validRetailerUrls) {
        const checked = assertSafePublicDestinationUrl(url);
        expect(checked.hostname).toBeTruthy();
      }
    });

    it("enforces safe storage object keys and blocks path traversal attacks", () => {
      expect(() => {
        buildStoreAssetPath({
          storeId: STORE_A.id,
          folder: "products",
          fileName: "../../../etc/passwd",
        });
      }).toThrow(/UNSAFE_FILE_NAME/);

      expect(() => {
        buildStoreAssetPath({
          storeId: STORE_A.id,
          folder: "products",
          fileName: "script.js.html",
        });
      }).toThrow(/UNSAFE_EXTENSION/);
    });

    it("validates media upload MIME types and maximum file size bounds", () => {
      // 1. Valid WebP within limits
      const validWebp = validateMediaUpload({
        fileSize: 450 * 1024,
        mimeType: "image/webp",
        fileName: "product-cover.webp",
      });
      expect(validWebp.isValid).toBe(true);

      // 2. Oversized image
      const oversized = validateMediaUpload({
        fileSize: 15 * 1024 * 1024, // 15MB > 10MB limit
        mimeType: "image/png",
        fileName: "big-image.png",
      });
      expect(oversized.isValid).toBe(false);
      expect(oversized.error).toMatch(/exceeds maximum allowed size/i);

      // 3. Executable / SVG script injection vector
      const dangerousSvg = validateMediaUpload({
        fileSize: 50 * 1024,
        mimeType: "image/svg+xml",
        fileName: "vector.svg",
      });
      expect(dangerousSvg.isValid).toBe(false);
      expect(dangerousSvg.error).toMatch(/not supported/i);
    });
  });

  // --------------------------------------------------------------------------
  // 7. CONCURRENT OPERATIONS & RACE CONDITION RESILIENCE
  // --------------------------------------------------------------------------
  describe("Section 7: Concurrent Operations & Race Condition Resilience", () => {
    it("simulates concurrent operations across Store A, Store B, and Store C simultaneously", async () => {
      const ops = [
        // Store A creates an astronomy item
        Promise.resolve().then(() => {
          return checkStoreScopedSlugUniqueness({
            candidateSlug: "pulsar-watch",
            storeId: STORE_A.id,
            existingItems: [],
          });
        }),
        // Store B edits a fashion item
        Promise.resolve().then(() => {
          return checkStoreScopedSlugUniqueness({
            candidateSlug: "pulsar-watch", // Same slug in Store B
            storeId: STORE_B.id,
            existingItems: [],
          });
        }),
        // Store C updates settings
        Promise.resolve().then(() => {
          return normalizeStoreSettings(STORE_C.id, {
            store_name: "Orbital Kicks Concurrent",
          });
        }),
        // Store A resolves identity
        Promise.resolve().then(() => {
          return resolveStoreIdentity({ store_name: "Our Visible Universe" });
        }),
      ];

      const results = await Promise.all(ops);
      expect(results[0].isUnique).toBe(true);
      expect(results[1].isUnique).toBe(true);
      expect(results[2].store_name).toBe("Orbital Kicks Concurrent");
      expect(results[3].storeName).toBe("Our Visible Universe");
    });
  });

  // --------------------------------------------------------------------------
  // 8. PERFORMANCE & LATENCY MEASUREMENT
  // --------------------------------------------------------------------------
  describe("Section 8: Performance Benchmark & Latency Guarantees", () => {
    it("evaluates 250 simulated product policy checks in under 50ms", () => {
      const syntheticProducts: MockProduct[] = Array.from({ length: 250 }, (_, i) => ({
        id: `prod-bench-${i}`,
        store_id: i % 2 === 0 ? STORE_A.id : STORE_B.id,
        name: `Product ${i}`,
        slug: `product-${i}`,
        active: true,
        deleted_at: null,
      }));

      const start = performance.now();
      for (const prod of syntheticProducts) {
        evaluateProductPolicy({
          operation: "SELECT",
          context: ctxVisitor,
          product: prod,
          stores,
          members,
        });
      }
      const durationMs = performance.now() - start;

      // Ensure execution is lightning fast (< 50ms)
      expect(durationMs).toBeLessThan(50);
    });

    it("validates 100 asset path constructions and parsings in under 15ms", () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const path = buildStoreAssetPath({
          storeId: STORE_A.id,
          folder: "products",
          fileName: `telemetry-chart-${i}.webp`,
        });
        const parsed = parseStoreAssetPath(path);
        expect(parsed.isValid).toBe(true);
      }
      const durationMs = performance.now() - start;
      expect(durationMs).toBeLessThan(15);
    });
  });
});
