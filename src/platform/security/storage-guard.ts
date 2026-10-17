import type { SecurityContext, RlsEvaluationResult } from "./types";
import { isStoreEditor, isStoreAdmin, isStoreMember, isSuperAdmin } from "./rls-policy-engine";
import { parseStoragePath } from "@/platform/storage/path-builder";
import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";

export interface StorageObjectRequest {
  bucketId: string;
  storagePath: string; // e.g. "stores/11111111-1111-1111-1111-111111111111/products/telescope.webp"
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  isPrivate?: boolean;
}

/**
 * Extracts the tenant store_id from a storage object path.
 */
export function extractTenantFromStoragePath(storagePath: string): string {
  try {
    const info = parseStoragePath(storagePath);
    return info.storeId;
  } catch {
    return LEGACY_STORE_ID;
  }
}

/**
 * Validates storage object access against multi-tenant row level security rules.
 */
export function evaluateStorageAccess(
  ctx: SecurityContext,
  req: StorageObjectRequest,
): RlsEvaluationResult {
  if (req.bucketId !== "store-images") {
    return { allowed: false, reason: "Unauthorized storage bucket." };
  }

  let tenantStoreId: string;
  let assetType: string;

  try {
    const info = parseStoragePath(req.storagePath);
    tenantStoreId = info.storeId;
    assetType = info.assetType;
  } catch (err) {
    return {
      allowed: false,
      reason: err instanceof Error ? err.message : "Invalid storage path structure.",
      violatingField: "storagePath",
    };
  }

  if (isSuperAdmin(ctx)) {
    return { allowed: true };
  }

  if (req.operation === "SELECT") {
    // Private documents or private flagged files require active store membership
    if (assetType === "documents" || req.isPrivate) {
      if (!isStoreMember(ctx, tenantStoreId)) {
        return {
          allowed: false,
          reason: "Access denied: confidential files require store membership.",
          violatingField: "storagePath",
        };
      }
      return { allowed: true };
    }

    // Public published assets (products, categories, branding, generated) are viewable
    return { allowed: true };
  }

  if (req.operation === "INSERT" || req.operation === "UPDATE") {
    if (!isStoreEditor(ctx, tenantStoreId)) {
      return {
        allowed: false,
        reason: "Cross-tenant storage violation: upload path does not belong to authorized store.",
        violatingField: "storagePath",
      };
    }
    return { allowed: true };
  }

  if (req.operation === "DELETE") {
    if (!isStoreAdmin(ctx, tenantStoreId)) {
      return {
        allowed: false,
        reason: "Cross-tenant storage violation: only Store Admins can delete store images.",
        violatingField: "storagePath",
      };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: "Unsupported storage operation." };
}
