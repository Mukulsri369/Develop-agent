export type AssetType = "products" | "categories" | "branding" | "generated" | "documents";

export type AssetVisibility = "public" | "private" | "unlisted";

export interface StoreAsset {
  id: string;
  store_id: string;
  bucket_id: string;
  storage_path: string;
  asset_type: AssetType;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  width?: number | null;
  height?: number | null;
  visibility: AssetVisibility;
  checksum_sha256?: string | null;
  uploaded_by?: string | null;
  is_ai_generated: boolean;
  ai_metadata?: Record<string, unknown>;
  usage_references?: Array<{ entityType: string; entityId: string }>;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoragePathInfo {
  storeId: string;
  assetType: AssetType;
  assetId: string;
  extension: string;
  isLegacy: boolean;
  rawPath: string;
}

export interface AssetUploadOptions {
  storeId: string;
  assetType: AssetType;
  visibility?: AssetVisibility;
  maxSizeBytes?: number;
  uploadedBy?: string | null;
  isAiGenerated?: boolean;
  aiMetadata?: Record<string, unknown>;
  usageReference?: { entityType: string; entityId: string };
}

export interface AssetValidationResult {
  valid: boolean;
  error?: string;
  sanitizedMime?: string;
}

export interface StoreStorageUsage {
  storeId: string;
  totalAssets: number;
  totalBytes: number;
  productAssets: number;
  brandingAssets: number;
  generatedAssets: number;
  quotaLimitBytes: number;
  quotaUsedPercent: number;
}
