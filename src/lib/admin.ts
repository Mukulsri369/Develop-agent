import { supabase } from "@/integrations/supabase/client";
import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";
import { buildTenantStoragePath, parseStoragePath } from "@/platform/storage/path-builder";

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
export const MAX_BYTES = 5 * 1024 * 1024;
export const HARD_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB limit

export function validateImage(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type))
    return `${file.name}: only JPG, JPEG, PNG, WEBP, or AVIF images are allowed.`;
  if (file.size > HARD_LIMIT_BYTES) return `${file.name}: image is larger than 10 MB.`;
  return null;
}

/** Resize to max 1600px and re-encode as WebP for fast public pages. */
async function optimize(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
    if (blob && blob.size < file.size) return blob;
  } catch {
    /* fall through to original */
  }
  return file;
}

export async function uploadImage(
  file: File,
  folder: "products" | "categories" | "branding",
  storeId: string = LEGACY_STORE_ID,
) {
  const err = validateImage(file);
  if (err) throw new Error(err);
  const blob = await optimize(file);
  if (blob.size > HARD_LIMIT_BYTES)
    throw new Error(`${file.name}: image is still larger than 10 MB after optimisation.`);

  const ext =
    blob.type === "image/webp"
      ? "webp"
      : blob.type === "image/avif"
        ? "avif"
        : file.name.split(".").pop()?.toLowerCase() || "jpg";

  const assetId = crypto.randomUUID();
  const path = buildTenantStoragePath(storeId, folder, ext, assetId);

  const { error } = await supabase.storage.from("store-images").upload(path, blob, {
    contentType: blob.type || file.type,
    cacheControl: "31536000",
    upsert: false,
  });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  // Record asset metadata in public.store_assets
  try {
    await supabase.from("store_assets").insert({
      id: assetId,
      store_id: storeId,
      bucket_id: "store-images",
      storage_path: path,
      asset_type: folder,
      file_name: file.name,
      mime_type: blob.type || file.type,
      file_size_bytes: blob.size,
      visibility: "public",
    });
  } catch {
    // Best effort metadata recording
  }

  return { path, url: `/api/public/img/${path}` };
}

export async function removeStoragePaths(
  paths: (string | null | undefined)[],
  callerStoreId?: string,
) {
  const validPaths = paths.filter(Boolean) as string[];
  if (!validPaths.length) return;

  const pathsToDelete: string[] = [];

  for (const p of validPaths) {
    try {
      const parsed = parseStoragePath(p);
      if (callerStoreId && parsed.storeId !== callerStoreId) {
        // Skip deleting files belonging to another store
        continue;
      }
      pathsToDelete.push(parsed.rawPath);
    } catch {
      // In case path is legacy or simple
      pathsToDelete.push(p);
    }
  }

  if (pathsToDelete.length) {
    await supabase.storage.from("store-images").remove(pathsToDelete);
    try {
      await supabase
        .from("store_assets")
        .update({ deleted_at: new Date().toISOString() })
        .in("storage_path", pathsToDelete);
    } catch {
      // Best effort
    }
  }
}

export function pathFromUrl(url: string | null | undefined) {
  if (!url) return null;
  const m = url.match(/\/api\/public\/img\/(.+)$/);
  return m ? m[1] : null;
}
