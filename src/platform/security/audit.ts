import type { TableAuditInfo } from "./types";

/**
 * Multi-Tenant Database RLS Authorization Audit Matrix
 * Documents the security status, tenancy keying, and policy coverage for each table.
 */
export const MULTI_TENANT_TABLE_AUDIT: Record<string, TableAuditInfo> = {
  stores: {
    tableName: "stores",
    primaryKey: "id",
    tenantKey: "id",
    rlsEnabled: true,
    immutableKeys: ["id"],
    policies: {
      select:
        "Public reads active stores; authenticated members read their store; super admins read all",
      insert: "Authenticated users create store with owner_id = auth.uid()",
      update: "Store owner or super admin update store metadata",
      delete: "Store owner or super admin delete/archive store",
    },
  },
  store_members: {
    tableName: "store_members",
    primaryKey: "id",
    tenantKey: "store_id",
    rlsEnabled: true,
    immutableKeys: ["id", "store_id", "user_id"],
    policies: {
      select: "Member reads own record; store admin reads all store members; super admin reads all",
      insert: "Store admin inserts new member (owner creation restricted to owner/super_admin)",
      update: "Store owner modifies roles; store admin cannot demote/promote owner",
      delete: "Store admin removes non-owners; member can remove self (leave) if not sole owner",
    },
  },
  store_domains: {
    tableName: "store_domains",
    primaryKey: "id",
    tenantKey: "store_id",
    rlsEnabled: true,
    immutableKeys: ["id", "store_id"],
    policies: {
      select: "Public reads verified domains of active stores; store admin reads all store domains",
      insert: "Store admin inserts domains for own store",
      update: "Store admin updates domain settings for own store",
      delete: "Store admin deletes domains for own store",
    },
  },
  store_invitations: {
    tableName: "store_invitations",
    primaryKey: "id",
    tenantKey: "store_id",
    rlsEnabled: true,
    immutableKeys: ["id", "store_id", "token"],
    policies: {
      select: "Store admin reads pending invitations for own store",
      insert: "Store admin creates invitations for own store",
      update: "No update (invitations are immutable tokens)",
      delete: "Store admin revokes invitations for own store",
    },
  },
  store_settings: {
    tableName: "store_settings",
    primaryKey: "store_id",
    tenantKey: "store_id",
    rlsEnabled: true,
    immutableKeys: ["store_id"],
    policies: {
      select: "Public reads non-sensitive settings (via view); store members read full settings",
      insert: "Store admin creates store settings",
      update: "Store admin updates store settings",
      delete: "Store owner deletes store settings",
    },
  },
  store_assets: {
    tableName: "store_assets",
    primaryKey: "id",
    tenantKey: "store_id",
    rlsEnabled: true,
    immutableKeys: ["id", "store_id", "storage_path"],
    policies: {
      select: "Public reads active public assets; store members read all assets for own store",
      insert: "Store editor inserts asset metadata; store_id must match membership",
      update: "Store admin updates asset metadata; store_id mutation blocked",
      delete: "Store admin deletes assets belonging to own store",
    },
  },
  products: {
    tableName: "products",
    primaryKey: "id",
    tenantKey: "store_id",
    rlsEnabled: true,
    immutableKeys: ["id", "store_id"],
    policies: {
      select:
        "Public reads live products of active stores; store members read all products for own store",
      insert:
        "Store editor inserts drafts; store admin inserts live products; store_id must match membership",
      update:
        "Store editor updates drafts; store admin updates live products; store_id mutation blocked",
      delete: "Store admin deletes products belonging to own store",
    },
  },
  categories: {
    tableName: "categories",
    primaryKey: "id",
    tenantKey: "store_id",
    rlsEnabled: true,
    immutableKeys: ["id", "store_id"],
    policies: {
      select:
        "Public reads active categories of active stores; store members read all categories for own store",
      insert: "Store admin inserts categories with matching store_id",
      update: "Store admin updates categories for own store; store_id mutation blocked",
      delete: "Store admin deletes categories for own store",
    },
  },
  product_images: {
    tableName: "product_images",
    primaryKey: "id",
    tenantKey: null,
    parentForeignKey: { table: "products", key: "product_id" },
    rlsEnabled: true,
    immutableKeys: ["id", "product_id"],
    policies: {
      select:
        "Public reads live product images; store members read images for own store's products",
      insert:
        "Store editor inserts images for own store's products; product_id must belong to own store",
      update: "Store editor updates image metadata; product_id mutation blocked",
      delete: "Store editor deletes images belonging to own store's products",
    },
  },
  product_features: {
    tableName: "product_features",
    primaryKey: "id",
    tenantKey: null,
    parentForeignKey: { table: "products", key: "product_id" },
    rlsEnabled: true,
    immutableKeys: ["id", "product_id"],
    policies: {
      select:
        "Public reads live product features; store members read features for own store's products",
      insert: "Store editor inserts features for own store's products",
      update: "Store editor updates features; product_id mutation blocked",
      delete: "Store editor deletes features belonging to own store's products",
    },
  },
  product_tags: {
    tableName: "product_tags",
    primaryKey: "id",
    tenantKey: null,
    parentForeignKey: { table: "products", key: "product_id" },
    rlsEnabled: true,
    immutableKeys: ["id", "product_id"],
    policies: {
      select: "Public reads live product tags; store members read tags for own store's products",
      insert: "Store editor inserts tags for own store's products",
      update: "Store editor updates tags; product_id mutation blocked",
      delete: "Store editor deletes tags belonging to own store's products",
    },
  },
  outbound_clicks: {
    tableName: "outbound_clicks",
    primaryKey: "id",
    tenantKey: "store_id",
    parentForeignKey: { table: "products", key: "product_id" },
    rlsEnabled: true,
    immutableKeys: ["id", "product_id", "store_id"],
    policies: {
      select: "Store admin reads click analytics for own store; super admin reads all",
      insert:
        "Public/authenticated logs click for live products; store_id must match product.store_id",
      update: "Blocked (clicks are immutable event logs)",
      delete: "Store owner deletes clicks if store is archived; super admin deletes",
    },
  },
};
