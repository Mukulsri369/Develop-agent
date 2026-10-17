import { describe, expect, it } from "vitest";
import { buildTenantStoragePath, parseStoragePath } from "@/platform/storage/path-builder";
import {
  validateMediaUpload,
  inspectBufferSafety,
  DEFAULT_MAX_IMAGE_BYTES,
} from "@/platform/storage/validator";
import {
  evaluateStorageAccess,
  extractTenantFromStoragePath,
} from "@/platform/security/storage-guard";
import { RlsPolicyEngine, type MockStore } from "@/platform/security/rls-policy-engine";
import type { SecurityContext } from "@/platform/security/types";
import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";
import { StoreAssetService } from "@/platform/storage/service";

describe("Phase 2 — Prompt 10: Multi-Tenant Media Storage, Asset Ownership & File Security", () => {
  // 3 Distinct Test Stores
  const storeTenant0: MockStore = {
    id: LEGACY_STORE_ID,
    name: "Our Visible Universe",
    owner_id: "user-owner-0",
    status: "active",
  };

  const storeA: MockStore = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Aurora Fashion Boutique",
    owner_id: "user-owner-a",
    status: "active",
  };

  const storeB: MockStore = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Apex Electronics & Rigs",
    owner_id: "user-owner-b",
    status: "active",
  };

  // Setup RLS Engine
  const engine = new RlsPolicyEngine();
  engine.registerStore(storeTenant0);
  engine.registerStore(storeA);
  engine.registerStore(storeB);

  // Security Contexts
  const visitorContext: SecurityContext = {
    userId: null,
    role: "anon",
    isSuperAdmin: false,
    storeMemberships: [],
  };

  const storeAAdminContext: SecurityContext = {
    userId: "user-admin-a",
    role: "admin",
    isSuperAdmin: false,
    storeMemberships: [{ storeId: storeA.id, role: "admin", status: "active" }],
  };

  const storeAEditorContext: SecurityContext = {
    userId: "user-editor-a",
    role: "editor",
    isSuperAdmin: false,
    storeMemberships: [{ storeId: storeA.id, role: "editor", status: "active" }],
  };

  const storeBAdminContext: SecurityContext = {
    userId: "user-admin-b",
    role: "admin",
    isSuperAdmin: false,
    storeMemberships: [{ storeId: storeB.id, role: "admin", status: "active" }],
  };

  describe("1. Tenant Path Construction & Parsing", () => {
    it("builds strictly partitioned paths matching stores/{store_id}/{type}/{asset_id}.{ext}", () => {
      const fixedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const pathA = buildTenantStoragePath(storeA.id, "products", "webp", fixedId);
      expect(pathA).toBe(`stores/${storeA.id}/products/${fixedId}.webp`);

      const pathB = buildTenantStoragePath(storeB.id, "branding", "avif", fixedId);
      expect(pathB).toBe(`stores/${storeB.id}/branding/${fixedId}.avif`);
    });

    it("parses modern tenant storage paths accurately", () => {
      const fixedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const path = `stores/${storeA.id}/categories/${fixedId}.png`;
      const parsed = parseStoragePath(path);

      expect(parsed.storeId).toBe(storeA.id);
      expect(parsed.assetType).toBe("categories");
      expect(parsed.assetId).toBe(fixedId);
      expect(parsed.extension).toBe("png");
      expect(parsed.isLegacy).toBe(false);
    });

    it("rejects path traversal attacks and malicious patterns", () => {
      expect(() => parseStoragePath("../secret/config.json")).toThrow(/traversal/i);
      expect(() => parseStoragePath("stores/../../etc/passwd")).toThrow(/traversal/i);
      expect(() =>
        parseStoragePath("stores/11111111-1111-1111-1111-111111111111//products/a.webp"),
      ).toThrow(/traversal/i);
      expect(() => parseStoragePath("stores\\something\\backslashes")).toThrow(/traversal/i);
    });
  });

  describe("2. Cross-Tenant Storage Authorization & Ownership", () => {
    const assetIdA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const pathA = `stores/${storeA.id}/products/${assetIdA}.webp`;

    const assetIdB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const pathB = `stores/${storeB.id}/products/${assetIdB}.webp`;

    it("allows Store A Editor/Admin to upload to Store A partition", () => {
      const res = evaluateStorageAccess(storeAEditorContext, {
        bucketId: "store-images",
        storagePath: pathA,
        operation: "INSERT",
      });
      expect(res.allowed).toBe(true);
    });

    it("strictly blocks Store A from uploading into Store B partition (cross-tenant overwrite attempt)", () => {
      const res = evaluateStorageAccess(storeAAdminContext, {
        bucketId: "store-images",
        storagePath: pathB,
        operation: "INSERT",
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cross-tenant storage violation");
      expect(res.violatingField).toBe("storagePath");
    });

    it("strictly blocks Store A from deleting Store B assets", () => {
      const res = evaluateStorageAccess(storeAAdminContext, {
        bucketId: "store-images",
        storagePath: pathB,
        operation: "DELETE",
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cross-tenant storage violation");
      expect(res.violatingField).toBe("storagePath");
    });

    it("allows Store B Admin to delete Store B assets", () => {
      const res = evaluateStorageAccess(storeBAdminContext, {
        bucketId: "store-images",
        storagePath: pathB,
        operation: "DELETE",
      });
      expect(res.allowed).toBe(true);
    });
  });

  describe("3. Public Delivery vs Private Asset Isolation", () => {
    const publicPathA = `stores/${storeA.id}/products/watch.webp`;
    const docPathA = `stores/${storeA.id}/documents/tax_id.pdf`;

    it("allows public visitors to view public product images", () => {
      const res = evaluateStorageAccess(visitorContext, {
        bucketId: "store-images",
        storagePath: publicPathA,
        operation: "SELECT",
        isPrivate: false,
      });
      expect(res.allowed).toBe(true);
    });

    it("blocks public visitors from viewing confidential documents", () => {
      const res = evaluateStorageAccess(visitorContext, {
        bucketId: "store-images",
        storagePath: docPathA,
        operation: "SELECT",
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("confidential files require store membership");
    });

    it("allows Store A members to read their own confidential documents", () => {
      const res = evaluateStorageAccess(storeAEditorContext, {
        bucketId: "store-images",
        storagePath: docPathA,
        operation: "SELECT",
      });
      expect(res.allowed).toBe(true);
    });

    it("blocks Store B members from reading Store A confidential documents", () => {
      const res = evaluateStorageAccess(storeBAdminContext, {
        bucketId: "store-images",
        storagePath: docPathA,
        operation: "SELECT",
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("confidential files require store membership");
    });
  });

  describe("4. File Format, MIME & Malicious Script Prevention", () => {
    it("accepts valid JPEG, PNG, WebP, and AVIF uploads", () => {
      expect(
        validateMediaUpload({ name: "optic.jpg", size: 1024 * 500, type: "image/jpeg" }).valid,
      ).toBe(true);
      expect(
        validateMediaUpload({ name: "banner.png", size: 1024 * 800, type: "image/png" }).valid,
      ).toBe(true);
      expect(
        validateMediaUpload({ name: "item.webp", size: 1024 * 200, type: "image/webp" }).valid,
      ).toBe(true);
      expect(
        validateMediaUpload({ name: "hero.avif", size: 1024 * 150, type: "image/avif" }).valid,
      ).toBe(true);
    });

    it("rejects oversized images (>10MB)", () => {
      const result = validateMediaUpload({
        name: "huge.jpg",
        size: DEFAULT_MAX_IMAGE_BYTES + 1024,
        type: "image/jpeg",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds maximum allowed limit");
    });

    it("rejects dangerous executable and script file types", () => {
      expect(
        validateMediaUpload({ name: "evil.svg", size: 500, type: "image/svg+xml" }).valid,
      ).toBe(false);
      expect(validateMediaUpload({ name: "hack.html", size: 500, type: "text/html" }).valid).toBe(
        false,
      );
      expect(
        validateMediaUpload({ name: "trojan.exe", size: 500, type: "application/x-msdownload" })
          .valid,
      ).toBe(false);
      expect(
        validateMediaUpload({ name: "script.js", size: 500, type: "application/javascript" }).valid,
      ).toBe(false);
    });

    it("detects and rejects active script injection disguised in image buffers", () => {
      const safeBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(inspectBufferSafety(safeBuffer)).toBe(true);

      const maliciousSvgString = `<svg onload="alert('xss')"></svg>`;
      expect(inspectBufferSafety(maliciousSvgString)).toBe(false);

      const scriptEmbedded = `GIF89a<script>fetch('/api/keys')</script>`;
      expect(inspectBufferSafety(scriptEmbedded)).toBe(false);
    });
  });

  describe("5. Legacy Astronomy Store Asset Compatibility", () => {
    it("transparently maps legacy single-tenant paths to Tenant 0", () => {
      const legacyProd = "products/telescope-celestron.webp";
      const parsedProd = parseStoragePath(legacyProd);
      expect(parsedProd.isLegacy).toBe(true);
      expect(parsedProd.storeId).toBe(LEGACY_STORE_ID);
      expect(parsedProd.assetType).toBe("products");

      const legacyBranding = "branding/ovu-logo.png";
      const parsedBrand = parseStoragePath(legacyBranding);
      expect(parsedBrand.isLegacy).toBe(true);
      expect(parsedBrand.storeId).toBe(LEGACY_STORE_ID);

      expect(extractTenantFromStoragePath(legacyProd)).toBe(LEGACY_STORE_ID);
      expect(extractTenantFromStoragePath(legacyBranding)).toBe(LEGACY_STORE_ID);
    });
  });

  describe("6. Concurrency Protection & Non-Collision", () => {
    it("generates collision-free UUID paths across concurrent upload calls", () => {
      const generatedPaths = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const path = buildTenantStoragePath(storeA.id, "products", "webp");
        expect(generatedPaths.has(path)).toBe(false);
        generatedPaths.add(path);
      }
      expect(generatedPaths.size).toBe(50);
    });
  });

  describe("7. Asset Metadata RLS & Storage Quota Tracking", () => {
    it("enforces tenant boundary on store_assets database records", () => {
      const assetA = {
        store_id: storeA.id,
        storage_path: `stores/${storeA.id}/products/a.webp`,
        visibility: "public",
      };

      // Store A Editor can insert metadata
      expect(engine.evaluateStoreAsset(storeAEditorContext, "INSERT", assetA).allowed).toBe(true);

      // Store B Admin cannot insert metadata into Store A
      const crossInsert = engine.evaluateStoreAsset(storeBAdminContext, "INSERT", assetA);
      expect(crossInsert.allowed).toBe(false);
      expect(crossInsert.reason).toContain("Access denied");

      // Mutation of store_id is blocked
      const mutRes = engine.evaluateStoreAsset(
        storeAAdminContext,
        "UPDATE",
        { store_id: storeB.id },
        { store_id: storeA.id },
      );
      expect(mutRes.allowed).toBe(false);
      expect(mutRes.reason).toContain("Cross-tenant mutation forbidden");
    });

    it("calculates storage usage summary correctly", async () => {
      const usage = await StoreAssetService.getStoreUsage(storeA.id);
      expect(usage.storeId).toBe(storeA.id);
      expect(usage.quotaLimitBytes).toBe(500 * 1024 * 1024);
      expect(usage.quotaUsedPercent).toBeGreaterThanOrEqual(0);
    });
  });
});
