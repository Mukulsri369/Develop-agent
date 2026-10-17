import type { Database } from "@/integrations/supabase/types";

export type PublicSiteSettings = Database["public"]["Views"]["public_site_settings"]["Row"];

export interface StoreIdentityConfig {
  storeName: string;
  storeSubtext: string;
  tagline: string;
  description: string;
  logoUrl?: string | null;
  searchPlaceholder: string;
  instagramUrl?: string | null;
  affiliateDisclosure: string;
  footerText: string;
  socialLinks: Record<string, string>;
  copyrightYear: number;
  themeId: string;
  primaryNav: Array<{ to: string; label: string; hash?: boolean }>;
}

export const DEFAULT_ASTRONOMY_IDENTITY: StoreIdentityConfig = {
  storeName: "Our Visible Universe",
  storeSubtext: "Store",
  tagline: "Explore the universe. Discover something extraordinary.",
  description:
    "Discover astronomy-inspired products, space gear, cosmic décor, apparel and gifts curated for curious minds.",
  logoUrl: null,
  searchPlaceholder: "Search telescopes, galaxy, Saturn…",
  instagramUrl: null,
  affiliateDisclosure:
    "As an Amazon Associate, Our Visible Universe earns from qualifying purchases. When you buy through links on this site, we may earn a commission at no extra cost to you.",
  footerText: "Explore the universe. Discover something extraordinary.",
  socialLinks: {},
  copyrightYear: new Date().getFullYear(),
  themeId: "astronomy",
  primaryNav: [
    { to: "/shop", label: "Shop" },
    { to: "/search", label: "Categories", hash: true },
    { to: "/about", label: "About" },
    { to: "/contact", label: "Contact" },
  ],
};

import type { PublicStoreSettings } from "./settings/types";

export type ResolvableStoreSettings =
  Partial<PublicSiteSettings> | Partial<PublicStoreSettings> | null | undefined;

/**
 * Resolves the active store identity by merging defaults with authoritative database store_settings.
 * Ensures database settings always take precedence while preserving exact fallback visual parity.
 */
export function resolveStoreIdentity(settings?: ResolvableStoreSettings): StoreIdentityConfig {
  if (!settings) return DEFAULT_ASTRONOMY_IDENTITY;

  const social = (settings.social_links as Record<string, string> | null) || {};
  const settingsObj = settings as Record<string, unknown>;
  const tagline = typeof settingsObj.tagline === "string" ? settingsObj.tagline : undefined;
  const description =
    typeof settingsObj.store_description === "string" ? settingsObj.store_description : undefined;

  return {
    ...DEFAULT_ASTRONOMY_IDENTITY,
    storeName: settings.store_name?.trim() || DEFAULT_ASTRONOMY_IDENTITY.storeName,
    tagline: tagline?.trim() || DEFAULT_ASTRONOMY_IDENTITY.tagline,
    description: description?.trim() || DEFAULT_ASTRONOMY_IDENTITY.description,
    logoUrl: settings.logo_url ?? DEFAULT_ASTRONOMY_IDENTITY.logoUrl,
    instagramUrl: settings.instagram_url ?? DEFAULT_ASTRONOMY_IDENTITY.instagramUrl,
    affiliateDisclosure:
      settings.affiliate_disclosure?.trim() || DEFAULT_ASTRONOMY_IDENTITY.affiliateDisclosure,
    footerText: settings.footer_text?.trim() || DEFAULT_ASTRONOMY_IDENTITY.footerText,
    socialLinks: social,
  };
}
