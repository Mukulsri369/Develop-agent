import type { AssetValidationResult } from "./types";

export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_MIME_TYPES = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

const FORBIDDEN_CONTENT_PATTERNS = [
  /<\s*script/i,
  /javascript:/i,
  /<\s*svg/i,
  /<\s*html/i,
  /onload\s*=/i,
  /onerror\s*=/i,
  /<\s*iframe/i,
];

/**
 * Validates an upload file against allowed image formats, size limits, and malicious payload patterns.
 */
export function validateMediaUpload(
  file: { name: string; size: number; type: string },
  maxBytes: number = DEFAULT_MAX_IMAGE_BYTES,
): AssetValidationResult {
  if (!file) {
    return { valid: false, error: "No file provided for upload." };
  }

  // 1. File size checks
  if (file.size <= 0) {
    return { valid: false, error: `${file.name}: file is empty.` };
  }
  if (file.size > maxBytes) {
    const mbLimit = (maxBytes / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      error: `${file.name}: file size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed limit of ${mbLimit} MB.`,
    };
  }

  // 2. MIME type verification
  const normalizedMime = file.type.trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    return {
      valid: false,
      error: `${file.name}: unsupported file format (${normalizedMime || "unknown"}). Only JPG, PNG, WebP, and AVIF are permitted.`,
    };
  }

  // 3. Reject active script content & dangerous file extensions
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const dangerousExtensions = ["svg", "html", "htm", "php", "js", "exe", "sh", "bat"];
  if (dangerousExtensions.includes(ext)) {
    return {
      valid: false,
      error: `Security violation: file extension .${ext} is forbidden to prevent script execution.`,
    };
  }

  return {
    valid: true,
    sanitizedMime: normalizedMime,
  };
}

/**
 * Inspects raw buffer or text slice to ensure untrusted code is not disguised as an image.
 */
export function inspectBufferSafety(buffer: Uint8Array | string): boolean {
  const textSample =
    typeof buffer === "string"
      ? buffer.slice(0, 4096)
      : new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(0, 4096));

  for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
    if (pattern.test(textSample)) {
      return false; // Malicious payload detected
    }
  }

  return true;
}
