import type { StoreSettings, PublicStoreSettings } from "./types";
import { LEGACY_STORE_ID } from "@/platform/tenancy/constants";

export const DEFAULT_ASTRONOMY_STORE_SETTINGS: StoreSettings = {
  store_id: LEGACY_STORE_ID,
  store_name: "Our Visible Universe",
  tagline: "Explore the universe. Discover something extraordinary.",
  store_description:
    "Discover astronomy-inspired products, space gear, cosmic décor, apparel and gifts curated for curious minds.",
  business_category: "astronomy",
  logo_url: null,
  favicon_url: null,
  contact_email: null,
  support_email: null,
  support_url: null,
  contact_details: {
    supportHours: "Mon - Fri, 9am - 5pm UTC",
    inquiryNotice:
      "For order, payment, delivery or return questions, please contact the retailer shown on the linked product page.",
  },
  instagram_url: null,
  youtube_url: null,
  facebook_url: null,
  twitter_url: null,
  social_links: {},
  affiliate_disclosure:
    "As an Amazon Associate, Our Visible Universe earns from qualifying purchases. When you buy through links on this site, we may earn a commission at no extra cost to you.",
  supported_retailers: [
    {
      name: "Amazon",
      code: "amazon",
      trackingId: null,
      tagParam: "tag",
      disclosureText: "Earns from qualifying Amazon purchases.",
      enabled: true,
    },
    {
      name: "Flipkart",
      code: "flipkart",
      trackingId: null,
      tagParam: "affid",
      disclosureText: "Earns from qualifying Flipkart purchases.",
      enabled: true,
    },
  ],
  affiliate_config: {
    defaultRetailer: "amazon",
    supportedRetailers: [
      {
        name: "Amazon",
        code: "amazon",
        trackingId: null,
        tagParam: "tag",
        disclosureText: "Earns from qualifying Amazon purchases.",
        enabled: true,
      },
      {
        name: "Flipkart",
        code: "flipkart",
        trackingId: null,
        tagParam: "affid",
        disclosureText: "Earns from qualifying Flipkart purchases.",
        enabled: true,
      },
    ],
    amazonAssociateTag: null,
    flipkartAffiliateId: null,
    outboundTrackingEnabled: true,
    commissionNotice:
      "Prices and availability are set by each retailer and may change at any time.",
  },
  about_content: {
    eyebrow: "Our story",
    title: "About the store",
    intro: "A curated extension of the Our Visible Universe journey.",
    storyMarkdown:
      "Our Visible Universe exists to make the cosmos feel closer. This store gathers astronomy-inspired products — telescopes, space décor, apparel, educational kits and gifts — that we believe help people explore, learn and wonder.",
    howItWorks:
      "We don't sell products directly. Each item links to a partner retailer such as Amazon or Flipkart, where the retailer handles checkout, payment, delivery and returns. When you buy through our links we may earn a small commission, at no extra cost to you.",
    promises: [
      "Products are hand-selected, never auto-scraped.",
      "We never invent prices or claim lowest price deals.",
      "We clearly disclose our affiliate relationship.",
    ],
  },
  footer_text: "Explore the universe. Discover something extraordinary.",
  public_policies: {
    privacyPolicyUrl: "/privacy",
    termsUrl: "/terms",
    affiliateDisclosureUrl: "/affiliate-disclosure",
    customLegalNotice: null,
  },
  default_locale: "en-US",
  currency: "USD",
  timezone: "UTC",
  promotions: {
    bannerEnabled: false,
    bannerText: null,
    bannerLink: null,
    festival_special: {
      enabled: true,
      title: "Cosmic Festival Special",
      eyebrow: "Celestial Curation",
      description: "Handpicked celestial favorites for the festive season.",
      product_ids: [],
    },
    category_spotlights: {},
    seasonalCampaignName: "Cosmic Holidays",
  },
  feature_flags: {
    enable_festival: true,
    enable_spotlights: true,
    enable_galaxy_background: true,
    enable_reviews: false,
    enable_currency_selector: false,
  },
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

export const DEFAULT_TENANT_STORE_SETTINGS: Omit<
  StoreSettings,
  "store_id" | "store_name" | "created_at" | "updated_at"
> = {
  tagline: "Curated products for extraordinary minds.",
  store_description: "Discover curated items and gear from top retailers.",
  business_category: "general",
  logo_url: null,
  favicon_url: null,
  contact_email: null,
  support_email: null,
  support_url: null,
  contact_details: {
    supportHours: "Mon - Fri, 9am - 5pm",
    inquiryNotice:
      "For order, payment, delivery or return questions, please contact the retailer shown on the linked product page.",
  },
  instagram_url: null,
  youtube_url: null,
  facebook_url: null,
  twitter_url: null,
  social_links: {},
  affiliate_disclosure:
    "When you buy through links on this site, we may earn an affiliate commission at no extra cost to you.",
  supported_retailers: [
    {
      name: "Amazon",
      code: "amazon",
      trackingId: null,
      tagParam: "tag",
      disclosureText: "Earns from qualifying Amazon purchases.",
      enabled: true,
    },
  ],
  affiliate_config: {
    defaultRetailer: "amazon",
    supportedRetailers: [
      {
        name: "Amazon",
        code: "amazon",
        trackingId: null,
        tagParam: "tag",
        disclosureText: "Earns from qualifying Amazon purchases.",
        enabled: true,
      },
    ],
    amazonAssociateTag: null,
    flipkartAffiliateId: null,
    outboundTrackingEnabled: true,
  },
  about_content: {
    eyebrow: "Our story",
    title: "About the store",
    intro: "Handpicked quality products curated from leading retailers.",
    storyMarkdown: "We curate the best products and guide you to trusted retailers.",
    howItWorks:
      "Each item links to a partner retailer who handles checkout, payment, delivery and returns.",
    promises: [
      "Products are hand-selected with high editorial standards.",
      "Clear, transparent affiliate disclosures.",
    ],
  },
  footer_text: "Explore the catalog. Discover extraordinary products.",
  public_policies: {
    privacyPolicyUrl: "/privacy",
    termsUrl: "/terms",
    affiliateDisclosureUrl: "/affiliate-disclosure",
  },
  default_locale: "en-US",
  currency: "USD",
  timezone: "UTC",
  promotions: {
    bannerEnabled: false,
    festival_special: {
      enabled: false,
      title: "Featured Collection",
      eyebrow: "Curated Selection",
      description: "Our handpicked highlights.",
      product_ids: [],
    },
    category_spotlights: {},
  },
  feature_flags: {
    enable_festival: false,
    enable_spotlights: true,
    enable_galaxy_background: false,
    enable_reviews: false,
    enable_currency_selector: false,
  },
};
