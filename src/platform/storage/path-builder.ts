import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";
import type { AssetType, StoragePathInfo } from "./types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);
const VALID_ASSET_TYPES = new Set<AssetType>([
  "products",
  "categories",
  "branding",
  "generated",
  "documents",
]);

/**
 * Builds a deterministic, tenant-partitioned storage path.
 * Format: stores/{store_id}/{asset_type}/{asset_id}.{extension}
 */
export function buildTenantStoragePath(
  storeId: string,
  assetType: AssetType,
  fileExtension: string,
  assetId?: string,
): string {
  const cleanStoreId = storeId.trim().toLowerCase();
  if (!UUID_REGEX.test(cleanStoreId)) {
    throw new Error(`Invalid store ID for storage path: ${storeId}`);
  }

  if (!VALID_ASSET_TYPES.has(assetType)) {
    throw new Error(`Invalid asset type for storage path: ${assetType}`);
  }

  const cleanExt = fileExtension.replace(/^\.+/, "").trim().toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(cleanExt)) {
    throw new Error(`File extension not allowed: .${cleanExt}`);
  }

  const cleanAssetId = (assetId || crypto.randomUUID()).trim().toLowerCase();
  if (!UUID_REGEX.test(cleanAssetId)) {
    throw new Error(`Invalid asset ID for storage path: ${cleanAssetId}`);
  }

  return `stores/${cleanStoreId}/${assetType}/${cleanAssetId}.${cleanExt}`;
}

/**
 * Parses and verifies any storage path, extracting tenant ID, asset type, and legacy status.
 */
export function parseStoragePath(rawPath: string): StoragePathInfo {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error("Invalid or empty storage path.");
  }

  // Security check: disallow path traversal, backslashes, or control characters
  if (
    rawPath.includes("..") ||
    rawPath.includes("\\") ||
    rawPath.includes("\0") ||
    rawPath.includes("//")
  ) {
    throw new Error("Security violation: path traversal detected in storage path.");
  }

  const cleanPath = rawPath.replace(/^\/+/, "").trim();
  const segments = cleanPath.split("/");

  // 1. Modern Multi-Tenant Pattern: stores/{store_id}/{asset_type}/{asset_id}.{ext}
  if (segments.length === 4 && segments[0] === "stores") {
    const storeId = segments[1].toLowerCase();
    const assetType = segments[2].toLowerCase() as AssetType;
    const fileWithExt = segments[3];
    const dotIndex = fileWithExt.lastIndexOf(".");

    if (!UUID_REGEX.test(storeId)) {
      throw new Error(`Invalid store UUID in storage path: ${storeId}`);
    }

    if (!VALID_ASSET_TYPES.has(assetType)) {
      throw new Error(`Invalid asset classification in storage path: ${assetType}`);
    }

    const assetId = dotIndex !== -1 ? fileWithExt.slice(0, dotIndex) : fileWithExt;
    const extension = dotIndex !== -1 ? fileWithExt.slice(dotIndex + 1).toLowerCase() : "";

    return {
      storeId,
      assetType,
      assetId,
      extension,
      isLegacy: false,
      rawPath: cleanPath,
    };
  }

  // 2. Direct Store UUID Pattern: {store_id}/{asset_type}/{asset_id}.{ext}
  if (segments.length === 3 && UUID_REGEX.test(segments[0])) {
    const storeId = segments[0].toLowerCase();
    const assetType = segments[1].toLowerCase() as AssetType;
    const fileWithExt = segments[2];
    const dotIndex = fileWithExt.lastIndexOf(".");
    const assetId = dotIndex !== -1 ? fileWithExt.slice(0, dotIndex) : fileWithExt;
    const extension = dotIndex !== -1 ? fileWithExt.slice(dotIndex + 1).toLowerCase() : "";

    return {
      storeId,
      assetType: VALID_ASSET_TYPES.has(assetType) ? assetType : "products",
      assetId,
      extension,
      isLegacy: false,
      rawPath: cleanPath,
    };
  }

  // 3. Legacy Single-Tenant Pattern: {folder}/{asset_id}.{ext}
  // All legacy files belong to Tenant 0 ("Our Visible Universe")
  if (segments.length === 2 && ["products", "categories", "branding"].includes(segments[0])) {
    const assetType = segments[0] as AssetType;
    const fileWithExt = segments[1];
    const dotIndex = fileWithExt.lastIndexOf(".");
    const assetId = dotIndex !== -1 ? fileWithExt.slice(0, dotIndex) : fileWithExt;
    const extension = dotIndex !== -1 ? fileWithExt.slice(dotIndex + 1).toLowerCase() : "";

    return {
      storeId: LEGACY_STORE_ID,
      assetType,
      assetId,
      extension,
      isLegacy: true,
      rawPath: cleanPath,
    };
  }

  throw new Error(`Unrecognized storage path format: ${rawPath}`);
}
