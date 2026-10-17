export type CurrencyCode = "USD" | "INR" | "EUR" | "GBP" | "CAD" | "AUD" | "JPY";

export interface ContactDetails {
  phone?: string | null;
  address?: string | null;
  supportHours?: string | null;
  supportUrl?: string | null;
  inquiryNotice?: string | null;
}

export interface SocialProfiles {
  instagram?: string | null;
  youtube?: string | null;
  facebook?: string | null;
  twitter?: string | null;
  tiktok?: string | null;
  pinterest?: string | null;
  [key: string]: string | null | undefined;
}

export interface RetailerAffiliatePartner {
  name: string;
  code: string;
  trackingId?: string | null;
  tagParam?: string | null;
  disclosureText?: string | null;
  enabled: boolean;
}

export interface AffiliateConfiguration {
  defaultRetailer: string;
  supportedRetailers: RetailerAffiliatePartner[];
  amazonAssociateTag?: string | null;
  flipkartAffiliateId?: string | null;
  outboundTrackingEnabled: boolean;
  commissionNotice?: string | null;
}

export interface AboutStoreContent {
  eyebrow?: string;
  title?: string;
  intro?: string;
  storyMarkdown?: string;
  howItWorks?: string;
  promises?: string[];
}

export interface PublicPoliciesConfig {
  privacyPolicyUrl?: string | null;
  termsUrl?: string | null;
  affiliateDisclosureUrl?: string | null;
  customLegalNotice?: string | null;
}

export interface FestivalSpecialConfig {
  enabled: boolean;
  title: string;
  eyebrow: string;
  description: string;
  product_ids: string[];
}

export interface PromotionalSettings {
  bannerEnabled: boolean;
  bannerText?: string | null;
  bannerLink?: string | null;
  festival_special?: FestivalSpecialConfig;
  category_spotlights?: Record<string, string>;
  seasonalCampaignName?: string | null;
}

export interface StoreFeatureFlags {
  enable_festival?: boolean;
  enable_spotlights?: boolean;
  enable_galaxy_background?: boolean;
  enable_reviews?: boolean;
  enable_currency_selector?: boolean;
  [flag: string]: boolean | undefined;
}

/**
 * Full Store Settings row matching public.store_settings table.
 */
export interface StoreSettings {
  store_id: string;
  store_name: string;
  tagline: string;
  store_description: string;
  business_category: string;
  logo_url: string | null;
  favicon_url: string | null;
  contact_email: string | null;
  support_email: string | null;
  support_url: string | null;
  contact_details: ContactDetails;
  instagram_url: string | null;
  youtube_url: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
  social_links: SocialProfiles;
  affiliate_disclosure: string;
  supported_retailers: RetailerAffiliatePartner[];
  affiliate_config: AffiliateConfiguration;
  about_content: AboutStoreContent;
  footer_text: string;
  public_policies: PublicPoliciesConfig;
  default_locale: string;
  currency: CurrencyCode;
  timezone: string;
  promotions: PromotionalSettings;
  feature_flags: StoreFeatureFlags;
  created_at: string;
  updated_at: string;
}

/**
 * Publicly accessible store settings view (public.public_store_settings).
 * Omits private contact channels and internal security fields.
 */
export interface PublicStoreSettings {
  store_id: string;
  store_name: string;
  tagline: string;
  store_description: string;
  business_category: string;
  logo_url: string | null;
  favicon_url: string | null;
  support_url: string | null;
  contact_details: ContactDetails;
  instagram_url: string | null;
  youtube_url: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
  social_links: SocialProfiles;
  affiliate_disclosure: string;
  supported_retailers: RetailerAffiliatePartner[];
  about_content: AboutStoreContent;
  footer_text: string;
  public_policies: PublicPoliciesConfig;
  default_locale: string;
  currency: CurrencyCode;
  timezone: string;
  promotions: PromotionalSettings;
  feature_flags: StoreFeatureFlags;
  updated_at: string;
}

export type UpdateStoreSettingsInput = Partial<
  Omit<StoreSettings, "store_id" | "created_at" | "updated_at">
>;
