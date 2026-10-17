import { describe, expect, it } from "vitest";
import {
  RlsPolicyEngine,
  type MockStore,
  type MockProduct,
  type MockCategory,
  type MockStoreMember,
  type MockOutboundClick,
} from "@/platform/security/rls-policy-engine";
import type { SecurityContext } from "@/platform/security/types";
import { evaluateStorageAccess } from "@/platform/security/storage-guard";
import { MULTI_TENANT_TABLE_AUDIT } from "@/platform/security/audit";

describe("Phase 2 — Prompt 08: Cross-Tenant Row Level Security & Isolation", () => {
  // Test Tenants
  const storeA: MockStore = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Fashion Hub",
    owner_id: "user-owner-a",
    status: "active",
  };

  const storeB: MockStore = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Cosmic Gear",
    owner_id: "user-owner-b",
    status: "active",
  };

  const suspendedStore: MockStore = {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Suspended Store",
    owner_id: "user-owner-c",
    status: "suspended",
  };

  // Actors
  const anonVisitor: SecurityContext = {
    userId: null,
    role: "anon",
    isSuperAdmin: false,
    storeMemberships: [],
  };

  const storeAOwner: SecurityContext = {
    userId: "user-owner-a",
    role: "owner",
    isSuperAdmin: false,
    storeMemberships: [{ storeId: storeA.id, role: "owner", status: "active" }],
  };

  const storeAAdmin: SecurityContext = {
    userId: "user-admin-a",
    role: "admin",
    isSuperAdmin: false,
    storeMemberships: [{ storeId: storeA.id, role: "admin", status: "active" }],
  };

  const storeAEditor: SecurityContext = {
    userId: "user-editor-a",
    role: "editor",
    isSuperAdmin: false,
    storeMemberships: [{ storeId: storeA.id, role: "editor", status: "active" }],
  };

  const storeBAdmin: SecurityContext = {
    userId: "user-admin-b",
    role: "admin",
    isSuperAdmin: false,
    storeMemberships: [{ storeId: storeB.id, role: "admin", status: "active" }],
  };

  const platformSuperAdmin: SecurityContext = {
    userId: "user-super-admin",
    role: "super_admin",
    isSuperAdmin: true,
    storeMemberships: [],
  };

  // Sample Products
  const liveProductA: MockProduct = {
    id: "prod-a-live-1",
    store_id: storeA.id,
    name: "Running Shoes",
    slug: "running-shoes",
    active: true,
    deleted_at: null,
  };

  const draftProductA: MockProduct = {
    id: "prod-a-draft-1",
    store_id: storeA.id,
    name: "Winter Boots Draft",
    slug: "winter-boots",
    active: false,
    deleted_at: null,
  };

  const liveProductB: MockProduct = {
    id: "prod-b-live-1",
    store_id: storeB.id,
    name: "Astroscope 3000",
    slug: "astroscope-3000",
    active: true,
    deleted_at: null,
  };

  const draftProductB: MockProduct = {
    id: "prod-b-draft-1",
    store_id: storeB.id,
    name: "Nebula Lamp Draft",
    slug: "nebula-lamp",
    active: false,
    deleted_at: null,
  };

  const suspendedStoreProduct: MockProduct = {
    id: "prod-c-live-1",
    store_id: suspendedStore.id,
    name: "Suspended Item",
    slug: "suspended-item",
    active: true,
    deleted_at: null,
  };

  // Setup Engine
  const engine = new RlsPolicyEngine();
  engine.registerStore(storeA);
  engine.registerStore(storeB);
  engine.registerStore(suspendedStore);
  engine.registerProduct(liveProductA);
  engine.registerProduct(draftProductA);
  engine.registerProduct(liveProductB);
  engine.registerProduct(draftProductB);
  engine.registerProduct(suspendedStoreProduct);

  describe("1. Authorization Audit Matrix", () => {
    it("ensures all core commerce and store tables have RLS enabled and immutable keys", () => {
      const requiredTables = [
        "stores",
        "store_members",
        "store_domains",
        "store_settings",
        "products",
        "categories",
        "product_images",
        "outbound_clicks",
      ];

      for (const table of requiredTables) {
        const audit = MULTI_TENANT_TABLE_AUDIT[table];
        expect(audit).toBeDefined();
        expect(audit.rlsEnabled).toBe(true);
        expect(audit.policies.select).toBeTruthy();
        expect(audit.policies.insert).toBeTruthy();
        expect(audit.policies.update).toBeTruthy();
        expect(audit.policies.delete).toBeTruthy();
        expect(audit.immutableKeys?.length).toBeGreaterThan(0);
      }
    });
  });

  describe("2. Cross-Tenant Product Isolation (SELECT)", () => {
    it("allows public visitors to view live products in active stores only", () => {
      expect(engine.evaluateProduct(anonVisitor, "SELECT", liveProductA).allowed).toBe(true);
      expect(engine.evaluateProduct(anonVisitor, "SELECT", liveProductB).allowed).toBe(true);
    });

    it("prevents public visitors from reading draft products in any store", () => {
      expect(engine.evaluateProduct(anonVisitor, "SELECT", draftProductA).allowed).toBe(false);
      expect(engine.evaluateProduct(anonVisitor, "SELECT", draftProductB).allowed).toBe(false);
    });

    it("prevents public visitors from reading products belonging to suspended stores", () => {
      expect(engine.evaluateProduct(anonVisitor, "SELECT", suspendedStoreProduct).allowed).toBe(
        false,
      );
    });

    it("allows Store A members to read both live and draft products in Store A", () => {
      expect(engine.evaluateProduct(storeAAdmin, "SELECT", liveProductA).allowed).toBe(true);
      expect(engine.evaluateProduct(storeAAdmin, "SELECT", draftProductA).allowed).toBe(true);
      expect(engine.evaluateProduct(storeAEditor, "SELECT", draftProductA).allowed).toBe(true);
    });

    it("strictly prevents Store A Admin from reading draft products belonging to Store B", () => {
      const res = engine.evaluateProduct(storeAAdmin, "SELECT", draftProductB);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Access denied");
    });

    it("allows Platform Super Admin to inspect any product across all stores", () => {
      expect(engine.evaluateProduct(platformSuperAdmin, "SELECT", draftProductA).allowed).toBe(
        true,
      );
      expect(engine.evaluateProduct(platformSuperAdmin, "SELECT", draftProductB).allowed).toBe(
        true,
      );
      expect(
        engine.evaluateProduct(platformSuperAdmin, "SELECT", suspendedStoreProduct).allowed,
      ).toBe(true);
    });
  });

  describe("3. Cross-Tenant Product Creation & Mutation (INSERT / UPDATE)", () => {
    it("prevents Store A Admin from inserting a product into Store B", () => {
      const rogueProduct: MockProduct = {
        id: "prod-rogue-1",
        store_id: storeB.id, // Targeting Store B!
        name: "Unauthorized Injection",
        slug: "unauthorized-injection",
        active: false,
        deleted_at: null,
      };

      const res = engine.evaluateProduct(storeAAdmin, "INSERT", rogueProduct);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cross-tenant violation");
      expect(res.violatingField).toBe("store_id");
    });

    it("allows Store A Editor to create draft products in Store A, but forbids publishing active products directly", () => {
      const editorDraft: MockProduct = {
        id: "prod-editor-draft",
        store_id: storeA.id,
        name: "Editor Draft",
        slug: "editor-draft",
        active: false,
        deleted_at: null,
      };
      expect(engine.evaluateProduct(storeAEditor, "INSERT", editorDraft).allowed).toBe(true);

      const editorLive: MockProduct = {
        id: "prod-editor-live",
        store_id: storeA.id,
        name: "Editor Live",
        slug: "editor-live",
        active: true,
        deleted_at: null,
      };
      const res = engine.evaluateProduct(storeAEditor, "INSERT", editorLive);
      expect(res.allowed).toBe(false);
      expect(res.violatingField).toBe("active");
    });

    it("allows Store A Admin to publish active products in Store A", () => {
      const adminProduct: MockProduct = {
        id: "prod-admin-live",
        store_id: storeA.id,
        name: "Admin Live",
        slug: "admin-live",
        active: true,
        deleted_at: null,
      };
      expect(engine.evaluateProduct(storeAAdmin, "INSERT", adminProduct).allowed).toBe(true);
    });

    it("prevents Store A Admin from updating a product belonging to Store B", () => {
      const updatedB: MockProduct = {
        ...liveProductB,
        name: "Tampered Name",
      };
      const res = engine.evaluateProduct(storeAAdmin, "UPDATE", updatedB, liveProductB);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cross-tenant violation");
    });

    it("BLOCKS store_id mutation (anti-tampering transfer attack)", () => {
      const transferredProduct: MockProduct = {
        ...liveProductA,
        store_id: storeB.id, // Attempting to transfer Store A product to Store B!
      };
      const res = engine.evaluateProduct(storeAAdmin, "UPDATE", transferredProduct, liveProductA);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cross-tenant mutation forbidden");
      expect(res.violatingField).toBe("store_id");
    });

    it("prevents Store A Editor from publishing a draft product during UPDATE", () => {
      const publishedDraft: MockProduct = {
        ...draftProductA,
        active: true, // Editor trying to flip draft to live!
      };
      const res = engine.evaluateProduct(storeAEditor, "UPDATE", publishedDraft, draftProductA);
      expect(res.allowed).toBe(false);
      expect(res.violatingField).toBe("active");
    });
  });

  describe("4. Cross-Tenant Deletion (DELETE)", () => {
    it("prevents Store A Admin from deleting Store B products", () => {
      const res = engine.evaluateProduct(storeAAdmin, "DELETE", liveProductB);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cross-tenant violation");
    });

    it("prevents Store Editor from deleting products in own store (requires Admin)", () => {
      const res = engine.evaluateProduct(storeAEditor, "DELETE", draftProductA);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("only Store Admins can delete");
    });

    it("allows Store A Admin to delete products in Store A", () => {
      expect(engine.evaluateProduct(storeAAdmin, "DELETE", liveProductA).allowed).toBe(true);
    });
  });

  describe("5. Category Isolation & Protection", () => {
    const categoryA: MockCategory = {
      id: "cat-a-1",
      store_id: storeA.id,
      name: "Sneakers",
      slug: "sneakers",
      active: true,
    };

    const categoryB: MockCategory = {
      id: "cat-b-1",
      store_id: storeB.id,
      name: "Telescopes",
      slug: "telescopes",
      active: true,
    };

    it("prevents Store A Admin from creating a category in Store B", () => {
      const rogueCategory: MockCategory = {
        id: "cat-rogue",
        store_id: storeB.id,
        name: "Hacked Category",
        slug: "hacked",
        active: true,
      };
      const res = engine.evaluateCategory(storeAAdmin, "INSERT", rogueCategory);
      expect(res.allowed).toBe(false);
      expect(res.violatingField).toBe("store_id");
    });

    it("blocks store_id mutation on category updates", () => {
      const mutatedCategory: MockCategory = {
        ...categoryA,
        store_id: storeB.id,
      };
      const res = engine.evaluateCategory(storeAAdmin, "UPDATE", mutatedCategory, categoryA);
      expect(res.allowed).toBe(false);
      expect(res.violatingField).toBe("store_id");
    });

    it("prevents Store A Admin from deleting Store B categories", () => {
      const res = engine.evaluateCategory(storeAAdmin, "DELETE", categoryB);
      expect(res.allowed).toBe(false);
      expect(res.violatingField).toBe("store_id");
    });
  });

  describe("6. Product Children Isolation (Images, Features, Tags)", () => {
    it("prevents Store A Editor from attaching an image to Store B product", () => {
      const childImage = {
        id: "img-cross-1",
        product_id: liveProductB.id, // Belongs to Store B!
      };
      const res = engine.evaluateProductChild(storeAEditor, "INSERT", childImage);
      expect(res.allowed).toBe(false);
      expect(res.violatingField).toBe("product_id");
    });

    it("blocks reparenting product_id mutation on product images", () => {
      const oldImage = { id: "img-1", product_id: liveProductA.id };
      const newImage = { id: "img-1", product_id: liveProductB.id }; // Changed parent!
      const res = engine.evaluateProductChild(storeAEditor, "UPDATE", newImage, oldImage);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cross-product mutation forbidden");
    });
  });

  describe("7. Outbound Clicks Logging & Analytics Privacy", () => {
    it("allows click logging only when product is live and store_id matches", () => {
      const validClick: MockOutboundClick = {
        id: "click-1",
        product_id: liveProductA.id,
        store_id: storeA.id,
      };
      expect(engine.evaluateOutboundClick(anonVisitor, "INSERT", validClick).allowed).toBe(true);
    });

    it("rejects click logging when store_id is forged or mismatched", () => {
      const forgedClick: MockOutboundClick = {
        id: "click-forged",
        product_id: liveProductA.id, // Store A product
        store_id: storeB.id, // Store B ID forged!
      };
      const res = engine.evaluateOutboundClick(anonVisitor, "INSERT", forgedClick);
      expect(res.allowed).toBe(false);
      expect(res.violatingField).toBe("store_id");
    });

    it("prevents Store A Admin from reading Store B outbound click events", () => {
      const clickB: MockOutboundClick = {
        id: "click-b-1",
        product_id: liveProductB.id,
        store_id: storeB.id,
      };
      const res = engine.evaluateOutboundClick(storeAAdmin, "SELECT", clickB);
      expect(res.allowed).toBe(false);
      expect(res.violatingField).toBe("store_id");
    });

    it("forbids any UPDATE operation on click records (audit log immutability)", () => {
      const clickA: MockOutboundClick = {
        id: "click-a-1",
        product_id: liveProductA.id,
        store_id: storeA.id,
      };
      const res = engine.evaluateOutboundClick(storeAAdmin, "UPDATE", clickA);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("immutable event logs");
    });
  });

  describe("8. Store Membership & Privilege Escalation Prevention", () => {
    const ownerMemberA: MockStoreMember = {
      id: "mem-owner-a",
      store_id: storeA.id,
      user_id: "user-owner-a",
      role: "owner",
      membership_status: "active",
    };

    const adminMemberA: MockStoreMember = {
      id: "mem-admin-a",
      store_id: storeA.id,
      user_id: "user-admin-a",
      role: "admin",
      membership_status: "active",
    };

    it("prevents Store Admin from promoting themselves or another user to Owner", () => {
      const escalatedAdmin: MockStoreMember = {
        ...adminMemberA,
        role: "owner", // Admin attempting self-elevation!
      };
      const res = engine.evaluateStoreMember(storeAAdmin, "UPDATE", escalatedAdmin, adminMemberA);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Only the Store Owner can modify or transfer the owner role");
    });

    it("prevents Store Admin from deleting the Store Owner", () => {
      const res = engine.evaluateStoreMember(storeAAdmin, "DELETE", ownerMemberA);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cannot delete the store owner");
    });

    it("allows a non-owner member to delete self (leave store)", () => {
      const res = engine.evaluateStoreMember(storeAAdmin, "DELETE", adminMemberA);
      expect(res.allowed).toBe(true);
    });
  });

  describe("9. Storage Bucket Path Scoping Guard", () => {
    it("allows Store A Editor to upload images to Store A partition folder", () => {
      const res = evaluateStorageAccess(storeAEditor, {
        bucketId: "store-images",
        storagePath: `${storeA.id}/products/sneakers.jpg`,
        operation: "INSERT",
      });
      expect(res.allowed).toBe(true);
    });

    it("prevents Store A Editor from uploading images to Store B partition folder", () => {
      const res = evaluateStorageAccess(storeAEditor, {
        bucketId: "store-images",
        storagePath: `${storeB.id}/products/astro.jpg`,
        operation: "INSERT",
      });
      expect(res.allowed).toBe(false);
      expect(res.violatingField).toBe("storagePath");
    });

    it("prevents Store A Admin from deleting images from Store B storage partition", () => {
      const res = evaluateStorageAccess(storeAAdmin, {
        bucketId: "store-images",
        storagePath: `${storeB.id}/products/astro.jpg`,
        operation: "DELETE",
      });
      expect(res.allowed).toBe(false);
      expect(res.violatingField).toBe("storagePath");
    });

    it("allows Platform Super Admin global storage management across all partitions", () => {
      const res = evaluateStorageAccess(platformSuperAdmin, {
        bucketId: "store-images",
        storagePath: `${storeB.id}/products/astro.jpg`,
        operation: "DELETE",
      });
      expect(res.allowed).toBe(true);
    });
  });
});
