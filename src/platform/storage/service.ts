import { supabase } from "@/integrations/supabase/client";
import type { StoreAsset, AssetUploadOptions, StoreStorageUsage } from "./types";
import { buildTenantStoragePath, parseStoragePath } from "./path-builder";
import { validateMediaUpload, ALLOWED_MIME_TYPES } from "./validator";
import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";

/**
 * Optimizes an image File/Blob on client side (max 1600px width/height, re-encode to WebP/AVIF if smaller).
 */
export async function optimizeClientImage(file: File): Promise<Blob> {
  if (typeof window === "undefined" || !("createImageBitmap" in window)) {
    return file;
  }

  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(bmp, 0, 0, w, h);
    const optimized = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85),
    );

    if (optimized && optimized.size < file.size) {
      return optimized;
    }
  } catch {
    // Fall back to original file if optimization fails
  }

  return file;
}

export class StoreAssetService {
  /**
   * Upload an asset into the tenant partition and record metadata.
   */
  static async uploadAsset(
    file: File,
    options: AssetUploadOptions,
  ): Promise<{ asset: StoreAsset; url: string }> {
    const storeId = options.storeId || LEGACY_STORE_ID;
    const validation = validateMediaUpload(file, options.maxSizeBytes);
    if (!validation.valid) {
      throw new Error(validation.error || "File validation failed.");
    }

    const optimizedBlob = await optimizeClientImage(file);
    const mime = optimizedBlob.type || file.type || "image/webp";
    const ext = ALLOWED_MIME_TYPES.get(mime) || "webp";
    const assetId = crypto.randomUUID();
    const storagePath = buildTenantStoragePath(storeId, options.assetType, ext, assetId);

    // 1. Upload to Supabase Storage bucket
    const { error: uploadError } = await supabase.storage
      .from("store-images")
      .upload(storagePath, optimizedBlob, {
        contentType: mime,
        cacheControl: "31536000",
        upsert: false, // Disallow overwriting other files
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // 2. Insert metadata record in public.store_assets
    const assetRecord: Partial<StoreAsset> = {
      id: assetId,
      store_id: storeId,
      bucket_id: "store-images",
      storage_path: storagePath,
      asset_type: options.assetType,
      file_name: file.name,
      mime_type: mime,
      file_size_bytes: optimizedBlob.size,
      visibility: options.visibility || "public",
      uploaded_by: options.uploadedBy || null,
      is_ai_generated: options.isAiGenerated ?? false,
      ai_metadata: options.aiMetadata || {},
      usage_references: options.usageReference ? [options.usageReference] : [],
    };

    try {
      const { data: inserted, error: metaError } = await supabase
        .from("store_assets")
        .insert(assetRecord)
        .select()
        .single();

      if (!metaError && inserted) {
        return {
          asset: inserted as unknown as StoreAsset,
          url: `/api/public/img/${storagePath}`,
        };
      }
    } catch {
      // Best-effort database metadata recording
    }

    return {
      asset: {
        ...assetRecord,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as StoreAsset,
      url: `/api/public/img/${storagePath}`,
    };
  }

  /**
   * Delete an asset from storage and mark metadata as deleted.
   * Verifies that the storage path belongs to the caller's store.
   */
  static async deleteAsset(storagePath: string, callerStoreId?: string): Promise<void> {
    const pathInfo = parseStoragePath(storagePath);

    if (callerStoreId && pathInfo.storeId !== callerStoreId) {
      throw new Error(
        `Cross-tenant storage violation: caller store (${callerStoreId}) does not own asset (${pathInfo.storeId}).`,
      );
    }

    // 1. Remove from Supabase Storage
    const { error: storageError } = await supabase.storage
      .from("store-images")
      .remove([pathInfo.rawPath]);

    if (storageError) {
      throw new Error(`Failed to remove storage object: ${storageError.message}`);
    }

    // 2. Update metadata in store_assets (soft delete / status update)
    try {
      await supabase
        .from("store_assets")
        .update({ deleted_at: new Date().toISOString() })
        .eq("storage_path", pathInfo.rawPath);
    } catch {
      // Best effort
    }
  }

  /**
   * Get storage usage summary for quota tracking.
   */
  static async getStoreUsage(storeId: string): Promise<StoreStorageUsage> {
    try {
      const { data, error } = await supabase
        .from("store_assets")
        .select("asset_type, file_size_bytes, is_ai_generated")
        .eq("store_id", storeId)
        .is("deleted_at", null);

      if (!error && data) {
        let totalBytes = 0;
        let productAssets = 0;
        let brandingAssets = 0;
        let generatedAssets = 0;

        for (const row of data) {
          const size = Number(row.file_size_bytes) || 0;
          totalBytes += size;
          if (row.asset_type === "products") productAssets++;
          if (row.asset_type === "branding") brandingAssets++;
          if (row.is_ai_generated) generatedAssets++;
        }

        const quotaLimitBytes = 500 * 1024 * 1024; // 500 MB base quota
        const quotaUsedPercent = Math.min(100, (totalBytes / quotaLimitBytes) * 100);

        return {
          storeId,
          totalAssets: data.length,
          totalBytes,
          productAssets,
          brandingAssets,
          generatedAssets,
          quotaLimitBytes,
          quotaUsedPercent,
        };
      }
    } catch {
      // Return baseline
    }

    return {
      storeId,
      totalAssets: 0,
      totalBytes: 0,
      productAssets: 0,
      brandingAssets: 0,
      generatedAssets: 0,
      quotaLimitBytes: 500 * 1024 * 1024,
      quotaUsedPercent: 0,
    };
  }
}
