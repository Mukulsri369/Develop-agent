import { createFileRoute } from "@tanstack/react-router";

// Valid public path patterns:
// 1. Tenant path: stores/{uuid}/{products|categories|branding|generated}/{id}.{ext}
// 2. Legacy path: {products|categories|branding}/{id}.{ext}
const TENANT_PUBLIC_PATH_REGEX =
  /^stores\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(products|categories|branding|generated)\/[a-zA-Z0-9_\-.]+\.(webp|jpg|jpeg|png|avif)$/i;

const LEGACY_PUBLIC_PATH_REGEX =
  /^(products|categories|branding)\/[a-zA-Z0-9_\-.]+\.(webp|jpg|jpeg|png|avif)$/i;

export const Route = createFileRoute("/api/public/img/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const rawPath = (params as { _splat?: string })._splat ?? "";
        const path = rawPath.replace(/^\/+/, "").trim();

        // 1. Security Check: Path traversal and forbidden symbols
        if (
          !path ||
          path.includes("..") ||
          path.includes("\\") ||
          path.includes("\0") ||
          path.includes("//")
        ) {
          return new Response("Not found", { status: 404 });
        }

        // 2. Security Check: Private documents and administrative files are strictly blocked
        if (path.includes("/documents/") || path.startsWith("documents/")) {
          return new Response("Forbidden: confidential documents cannot be served publicly.", {
            status: 403,
          });
        }

        // 3. Security Check: Match validated tenant or legacy public path format
        if (!TENANT_PUBLIC_PATH_REGEX.test(path) && !LEGACY_PUBLIC_PATH_REGEX.test(path)) {
          return new Response("Not found", { status: 404 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.storage.from("store-images").download(path);
          if (error || !data) return new Response("Not found", { status: 404 });

          const ext = path.split(".").pop()?.toLowerCase();
          const contentType =
            ext === "webp"
              ? "image/webp"
              : ext === "png"
                ? "image/png"
                : ext === "avif"
                  ? "image/avif"
                  : "image/jpeg";

          return new Response(data, {
            headers: {
              "content-type": contentType,
              "cache-control": "public, max-age=31536000, immutable",
              "x-content-type-options": "nosniff",
              "content-security-policy": "default-src 'none'; sandbox",
            },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
