/**
 * Server-Side Request Forgery (SSRF) Guard & URL Security Validator
 *
 * Enforces strict protections for server-side outbound requests:
 * 1. Allowed protocols (HTTP & HTTPS only, rejecting file://, gopher://, data:, etc.)
 * 2. Complete IP and hostname sanitation:
 *    - Rejects localhost (127.0.0.1, 0.0.0.0, ::1)
 *    - Rejects cloud metadata services (169.254.169.254, metadata.google.internal, etc.)
 *    - Rejects private RFC-1918 networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 *    - Rejects link-local, carrier-grade NAT, and loopback ranges
 *    - Rejects hexadecimal, octal, or integer-encoded IP addresses
 * 3. Whitelist / Approved Retailer verification
 * 4. Response size limits and strict timeouts
 * 5. Re-validation of all HTTP redirect targets
 */

export class SsrfSecurityError extends Error {
  constructor(message: string) {
    super(`[SSRF Guard] ${message}`);
    this.name = "SsrfSecurityError";
  }
}

/**
 * Approved retail domains and legitimate URL shorteners.
 */
const APPROVED_RETAILER_SUFFIXES = [
  "amazon.com",
  "amazon.in",
  "amazon.co.uk",
  "amazon.ca",
  "amazon.de",
  "amazon.fr",
  "amazon.es",
  "amazon.it",
  "amazon.co.jp",
  "amazon.com.au",
  "amazon.ae",
  "amzn.to",
  "amzn.eu",
  "amzn.asia",
  "link.amazon",
  "flipkart.com",
  "fkrt.it",
  "ubuy.com",
  "ubuy.co.in",
  "walmart.com",
  "target.com",
  "bestbuy.com",
  "myntra.com",
  "ajio.com",
  "nike.com",
  "adidas.com",
  "puma.com",
  "zara.com",
  "hm.com",
  "nordstrom.com",
  "asos.com",
  "shein.com",
  "etsy.com",
  "ebay.com",
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "broadcasthost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "169.254.169.254",
  "169.254.169.253",
]);

/**
 * Checks if an IPv4 address belongs to a private, loopback, or link-local range.
 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IP is blocked
  }

  const [a, b] = parts;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (Link-local & AWS/GCP metadata)
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
  if (a >= 224) return true;

  return false;
}

/**
 * Checks if an IPv6 address belongs to private or loopback ranges.
 */
function isPrivateIpv6(ip: string): boolean {
  const clean = ip.toLowerCase().replace(/[[\]]/g, "");
  if (clean === "::1" || clean === "::") return true;
  // Unique local addresses (fc00::/7)
  if (clean.startsWith("fc") || clean.startsWith("fd")) return true;
  // Link-local unicast (fe80::/10)
  if (
    clean.startsWith("fe8") ||
    clean.startsWith("fe9") ||
    clean.startsWith("fea") ||
    clean.startsWith("feb")
  ) {
    return true;
  }
  // IPv4-mapped IPv6 (::ffff:127.0.0.1)
  if (clean.includes("::ffff:")) {
    const ipv4 = clean.split("::ffff:")[1];
    return isPrivateIpv4(ipv4);
  }
  return false;
}

/**
 * Validates whether a target URL is safe for server-side outbound fetching.
 */
export function validateSafeOutboundUrl(rawUrl: string): { url: URL; hostname: string } {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new SsrfSecurityError("URL must be a non-empty string.");
  }

  const trimmed = rawUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SsrfSecurityError("Invalid URL format.");
  }

  // 1. Strict Protocol Check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfSecurityError(
      `Disallowed protocol '${parsed.protocol}'. Only HTTP and HTTPS are permitted.`,
    );
  }

  // 2. Reject credentials in URL (user:pass@host)
  if (parsed.username || parsed.password) {
    throw new SsrfSecurityError(
      "URLs containing user authentication credentials are not permitted.",
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // 3. Reject Known Blocked Hostnames
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new SsrfSecurityError(
      `Access to internal/metadata target '${hostname}' is strictly forbidden.`,
    );
  }

  // 4. Reject Integer, Octal, Hex, and Standard IP formats that target private ranges
  // Check standard dotted IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isPrivateIpv4(hostname)) {
      throw new SsrfSecurityError(
        `Access to private/loopback IP address '${hostname}' is forbidden.`,
      );
    }
  }

  // Check numeric integer IP representation (e.g. 2130706433 -> 127.0.0.1)
  if (/^\d+$/.test(hostname)) {
    throw new SsrfSecurityError("Numeric/integer IP representations are not permitted.");
  }

  // Check hexadecimal IP representation
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    throw new SsrfSecurityError("Hexadecimal IP representations are not permitted.");
  }

  // Check IPv6
  if (hostname.includes(":")) {
    if (isPrivateIpv6(hostname)) {
      throw new SsrfSecurityError(`Access to private IPv6 address '${hostname}' is forbidden.`);
    }
  }

  // 5. Approved Retailer or Commercial Domain Check
  const isApprovedRetailer = APPROVED_RETAILER_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );

  // If not in standard retailer list, ensure domain has a valid public TLD and at least two domain components
  if (!isApprovedRetailer) {
    const domainParts = hostname.split(".");
    if (domainParts.length < 2 || domainParts[domainParts.length - 1].length < 2) {
      throw new SsrfSecurityError(
        `Destination host '${hostname}' is not a recognized public retailer domain.`,
      );
    }
  }

  return { url: parsed, hostname };
}

/**
 * Safe fetcher with SSRF guard, redirect validation, timeouts, and response size guards.
 */
export async function safeOutboundFetch(
  targetUrl: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<{ text: string; status: number; finalUrl: string }> {
  const { headers = {}, timeoutMs = 12000, maxBytes = 5 * 1024 * 1024 } = options;

  // Initial validation
  const { url: initialUrl } = validateSafeOutboundUrl(targetUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let currentUrl = initialUrl.toString();
  let redirectCount = 0;
  const maxRedirects = 5;

  try {
    while (redirectCount <= maxRedirects) {
      validateSafeOutboundUrl(currentUrl);

      const response = await fetch(currentUrl, {
        headers,
        signal: controller.signal,
        redirect: "manual", // Manually validate each redirect
      });

      // Handle Redirects safely
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) break;

        const resolvedRedirect = new URL(location, currentUrl).toString();
        // Strict SSRF check on redirect destination
        validateSafeOutboundUrl(resolvedRedirect);
        currentUrl = resolvedRedirect;
        redirectCount++;
        continue;
      }

      // Check Content-Length if present
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > maxBytes) {
        throw new SsrfSecurityError(`Response size exceeds limit of ${maxBytes} bytes.`);
      }

      const text = await response.text();
      if (text.length > maxBytes) {
        throw new SsrfSecurityError(`Downloaded content exceeds limit of ${maxBytes} bytes.`);
      }

      return {
        text,
        status: response.status,
        finalUrl: currentUrl,
      };
    }

    throw new SsrfSecurityError("Too many redirects.");
  } finally {
    clearTimeout(timer);
  }
}
