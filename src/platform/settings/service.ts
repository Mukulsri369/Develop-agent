import { supabase } from "@/integrations/supabase/client";
import type { StoreSettings, PublicStoreSettings, UpdateStoreSettingsInput } from "./types";
import { DEFAULT_ASTRONOMY_STORE_SETTINGS, DEFAULT_TENANT_STORE_SETTINGS } from "./constants";
import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";
import { isStoreAdmin, isStoreMember } from "@/platform/security/rls-policy-engine";
import type { SecurityContext } from "@/platform/security/types";

/**
 * Sanitizes a private StoreSettings row into a safe PublicStoreSettings object.
 */
export function sanitizePublicStoreSettings(settings: StoreSettings): PublicStoreSettings {
  const {
    contact_email: _privateContact,
    support_email: _privateSupport,
    created_at: _created,
    ...publicFields
  } = settings;

  return publicFields;
}

/**
 * Merges raw database store settings with baseline defaults to ensure no undefined fields.
 */
export function normalizeStoreSettings(
  storeId: string,
  raw?: Partial<StoreSettings> | null,
): StoreSettings {
  const isTenant0 = storeId === LEGACY_STORE_ID;
  const base = isTenant0
    ? DEFAULT_ASTRONOMY_STORE_SETTINGS
    : {
        ...DEFAULT_TENANT_STORE_SETTINGS,
        store_id: storeId,
        store_name: "Store",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

  if (!raw) {
    return { ...base, store_id: storeId };
  }

  return {
    ...base,
    ...raw,
    store_id: storeId,
    store_name: raw.store_name?.trim() || base.store_name,
    tagline: raw.tagline?.trim() || base.tagline,
    store_description: raw.store_description?.trim() || base.store_description,
    business_category: raw.business_category?.trim() || base.business_category,
    logo_url: raw.logo_url ?? base.logo_url,
    favicon_url: raw.favicon_url ?? base.favicon_url,
    contact_email: raw.contact_email ?? base.contact_email,
    support_email: raw.support_email ?? base.support_email,
    support_url: raw.support_url ?? base.support_url,
    contact_details: { ...base.contact_details, ...(raw.contact_details || {}) },
    instagram_url: raw.instagram_url ?? base.instagram_url,
    youtube_url: raw.youtube_url ?? base.youtube_url,
    facebook_url: raw.facebook_url ?? base.facebook_url,
    twitter_url: raw.twitter_url ?? base.twitter_url,
    social_links: { ...base.social_links, ...(raw.social_links || {}) },
    affiliate_disclosure: raw.affiliate_disclosure?.trim() || base.affiliate_disclosure,
    supported_retailers:
      raw.supported_retailers && raw.supported_retailers.length > 0
        ? raw.supported_retailers
        : base.supported_retailers,
    affiliate_config: { ...base.affiliate_config, ...(raw.affiliate_config || {}) },
    about_content: { ...base.about_content, ...(raw.about_content || {}) },
    footer_text: raw.footer_text?.trim() || base.footer_text,
    public_policies: { ...base.public_policies, ...(raw.public_policies || {}) },
    default_locale: raw.default_locale?.trim() || base.default_locale,
    currency: raw.currency || base.currency,
    timezone: raw.timezone?.trim() || base.timezone,
    promotions: {
      ...base.promotions,
      ...(raw.promotions || {}),
      festival_special: {
        ...base.promotions.festival_special,
        ...(raw.promotions?.festival_special || {}),
      },
      category_spotlights: {
        ...base.promotions.category_spotlights,
        ...(raw.promotions?.category_spotlights || {}),
      },
    },
    feature_flags: { ...base.feature_flags, ...(raw.feature_flags || {}) },
    created_at: raw.created_at || base.created_at,
    updated_at: raw.updated_at || new Date().toISOString(),
  };
}

export class StoreSettingsService {
  /**
   * Fetch public store settings for storefront rendering.
   * Checks public.public_store_settings or falls back to sanitized defaults.
   */
  static async getPublicSettings(storeId: string = LEGACY_STORE_ID): Promise<PublicStoreSettings> {
    try {
      const { data, error } = await supabase
        .from("public_store_settings")
        .select("*")
        .eq("store_id", storeId)
        .maybeSingle();

      if (!error && data) {
        const full = normalizeStoreSettings(storeId, data as unknown as Partial<StoreSettings>);
        return sanitizePublicStoreSettings(full);
      }
    } catch {
      // In case public_store_settings view is not yet deployed in mock mode
    }

    // Fallback: check legacy public_site_settings if querying Tenant 0
    if (storeId === LEGACY_STORE_ID) {
      try {
        const { data: legacy } = await supabase
          .from("public_site_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle();

        if (legacy) {
          const social = (legacy.social_links as Record<string, unknown> | null) || {};
          const festSpecial =
            (social.festival_special as Record<string, unknown> | undefined) || {};
          const spotlights =
            (social.category_spotlights as Record<string, string> | undefined) || {};

          return sanitizePublicStoreSettings(
            normalizeStoreSettings(storeId, {
              store_name: legacy.store_name,
              logo_url: legacy.logo_url,
              instagram_url: legacy.instagram_url,
              affiliate_disclosure: legacy.affiliate_disclosure,
              footer_text: legacy.footer_text,
              social_links: social as Record<string, string>,
              promotions: {
                bannerEnabled: false,
                festival_special: {
                  enabled: festSpecial.enabled !== false,
                  title: (festSpecial.title as string) || "Cosmic Festival Special",
                  eyebrow: (festSpecial.eyebrow as string) || "Celestial Curation",
                  description:
                    (festSpecial.description as string) ||
                    "Handpicked celestial favorites for the festive season.",
                  product_ids: Array.isArray(festSpecial.product_ids)
                    ? (festSpecial.product_ids as string[])
                    : Array.isArray(social.festival_product_ids)
                      ? (social.festival_product_ids as string[])
                      : [],
                },
                category_spotlights: spotlights,
              },
            }),
          );
        }
      } catch {
        // Fallback to constants
      }
    }

    return sanitizePublicStoreSettings(normalizeStoreSettings(storeId, null));
  }

  /**
   * Fetch full administrative settings for a store.
   * Requires caller to be an authorized store member.
   */
  static async getAdminSettings(
    storeId: string,
    context?: SecurityContext | null,
  ): Promise<StoreSettings> {
    if (context && !context.isSuperAdmin && !isStoreMember(context, storeId)) {
      throw new Error(`Access denied: Actor is not a member of store ${storeId}`);
    }

    try {
      const { data, error } = await supabase
        .from("store_settings")
        .select("*")
        .eq("store_id", storeId)
        .maybeSingle();

      if (!error && data) {
        return normalizeStoreSettings(storeId, data as unknown as Partial<StoreSettings>);
      }
    } catch {
      // Continue to fallback
    }

    // Tenant 0 fallback to legacy site_settings
    if (storeId === LEGACY_STORE_ID) {
      try {
        const { data: legacy } = await supabase
          .from("site_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle();

        if (legacy) {
          const social = (legacy.social_links as Record<string, unknown> | null) || {};
          const festSpecial =
            (social.festival_special as Record<string, unknown> | undefined) || {};
          const spotlights =
            (social.category_spotlights as Record<string, string> | undefined) || {};

          return normalizeStoreSettings(storeId, {
            store_name: legacy.store_name,
            logo_url: legacy.logo_url,
            instagram_url: legacy.instagram_url,
            contact_email: legacy.contact_email,
            affiliate_disclosure: legacy.affiliate_disclosure,
            footer_text: legacy.footer_text,
            social_links: social as Record<string, string>,
            promotions: {
              bannerEnabled: false,
              festival_special: {
                enabled: festSpecial.enabled !== false,
                title: (festSpecial.title as string) || "Cosmic Festival Special",
                eyebrow: (festSpecial.eyebrow as string) || "Celestial Curation",
                description:
                  (festSpecial.description as string) ||
                  "Handpicked celestial favorites for the festive season.",
                product_ids: Array.isArray(festSpecial.product_ids)
                  ? (festSpecial.product_ids as string[])
                  : Array.isArray(social.festival_product_ids)
                    ? (social.festival_product_ids as string[])
                    : [],
              },
              category_spotlights: spotlights,
            },
          });
        }
      } catch {
        // Fallback
      }
    }

    return normalizeStoreSettings(storeId, null);
  }

  /**
   * Update store settings.
   * Requires caller to be store admin or store owner.
   */
  static async updateSettings(
    storeId: string,
    updates: UpdateStoreSettingsInput,
    context?: SecurityContext | null,
  ): Promise<StoreSettings> {
    if (context && !context.isSuperAdmin && !isStoreAdmin(context, storeId)) {
      throw new Error(
        `Access denied: Store admin permission required to update settings for store ${storeId}`,
      );
    }

    const current = await this.getAdminSettings(storeId, context);
    const updated = normalizeStoreSettings(storeId, {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    });

    try {
      const { error } = await supabase
        .from("store_settings")
        .upsert({
          store_id: storeId,
          store_name: updated.store_name,
          tagline: updated.tagline,
          store_description: updated.store_description,
          business_category: updated.business_category,
          logo_url: updated.logo_url,
          favicon_url: updated.favicon_url,
          contact_email: updated.contact_email,
          support_email: updated.support_email,
          support_url: updated.support_url,
          contact_details: updated.contact_details,
          instagram_url: updated.instagram_url,
          youtube_url: updated.youtube_url,
          facebook_url: updated.facebook_url,
          twitter_url: updated.twitter_url,
          social_links: updated.social_links,
          affiliate_disclosure: updated.affiliate_disclosure,
          supported_retailers: updated.supported_retailers,
          affiliate_config: updated.affiliate_config,
          about_content: updated.about_content,
          footer_text: updated.footer_text,
          public_policies: updated.public_policies,
          default_locale: updated.default_locale,
          currency: updated.currency,
          timezone: updated.timezone,
          promotions: updated.promotions,
          feature_flags: updated.feature_flags,
        })
        .eq("store_id", storeId);

      if (error) {
        // If store_settings table is not yet migrated, sync to site_settings for Tenant 0
        if (storeId === LEGACY_STORE_ID) {
          await supabase
            .from("site_settings")
            .update({
              store_name: updated.store_name,
              logo_url: updated.logo_url,
              instagram_url: updated.instagram_url,
              contact_email: updated.contact_email,
              affiliate_disclosure: updated.affiliate_disclosure,
              footer_text: updated.footer_text,
              social_links: {
                ...updated.social_links,
                festival_special: updated.promotions?.festival_special,
                category_spotlights: updated.promotions?.category_spotlights,
              },
            })
            .eq("id", 1);
        } else {
          throw error;
        }
      }
    } catch {
      // In local dev/fallback mode
    }

    return updated;
  }
}
