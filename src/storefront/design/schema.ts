import { z } from "zod";

export const ThemeColorsSchema = z.object({
  primary: z.string().describe("Primary brand color (hex, rgb, or oklch)"),
  primaryForeground: z.string().default("#ffffff"),
  secondary: z.string().default("#1e293b"),
  secondaryForeground: z.string().default("#f8fafc"),
  background: z.string().default("#0b0d1a"),
  foreground: z.string().default("#f8fafc"),
  card: z.string().default("#131728"),
  cardForeground: z.string().default("#f8fafc"),
  muted: z.string().default("#1e293b"),
  mutedForeground: z.string().default("#94a3b8"),
  accent: z.string().default("#38bdf8"),
  border: z.string().default("rgba(255, 255, 255, 0.1)"),
  ring: z.string().default("rgba(234, 179, 8, 0.6)"),
});

export const TypographyTokensSchema = z.object({
  headingFont: z.enum([
    "Instrument Serif",
    "Prata",
    "Cinzel",
    "Syne",
    "Plus Jakarta Sans",
    "Manrope",
    "JetBrains Mono",
    "Space Grotesk",
  ]),
  bodyFont: z.enum(["Manrope", "Plus Jakarta Sans", "Inter", "Geist"]),
  monoFont: z.enum(["JetBrains Mono", "Space Mono", "Fira Code"]),
  headingWeight: z.enum(["normal", "medium", "semibold", "bold"]).default("normal"),
  letterSpacing: z.enum(["tight", "normal", "wide", "widest"]).default("normal"),
});

export const BrandConfigSchema = z.object({
  storeName: z.string().min(1),
  tagline: z.string().default(""),
  description: z.string().default(""),
  logoUrl: z.string().url().optional().nullable(),
  industry: z.enum([
    "astronomy_space",
    "luxury_fashion",
    "streetwear_sneakers",
    "consumer_electronics",
    "home_decor",
    "beauty_cosmetics",
    "outdoor_adventure",
    "general_retail",
  ]),
  personality: z.enum([
    "cinematic_cosmic",
    "editorial_luxury",
    "neo_brutalist",
    "clean_minimalist",
    "warm_organic",
    "cyber_high_tech",
  ]),
  colors: ThemeColorsSchema,
  typography: TypographyTokensSchema,
  cornerStyle: z.enum(["sharp", "soft", "rounded", "full"]).default("rounded"),
});

export const SectionTypeEnum = z.enum([
  "editorial_hero",
  "cinematic_hero",
  "video_showcase_hero",
  "planet_hero_carousel",
  "featured_products_rail",
  "category_bento_grid",
  "product_spotlight_split",
  "brand_story_editorial",
  "three_scene_interactive",
  "promotional_banner",
  "faq_accordion",
  "footer_multicolumn",
  "footer_minimal",
]);

export const SectionConfigSchema = z.object({
  id: z.string(),
  type: SectionTypeEnum,
  visible: z.boolean().default(true),
  order: z.number().int().nonnegative(),
  headline: z.string().optional(),
  subheadline: z.string().optional(),
  badgeText: z.string().optional(),
  contentBinding: z
    .object({
      source: z.enum([
        "featured_products",
        "newest_products",
        "category_products",
        "custom_collection",
      ]),
      categoryId: z.string().optional(),
      collectionId: z.string().optional(),
      limit: z.number().int().positive().default(8),
    })
    .optional(),
  customProps: z.record(z.unknown()).default({}),
});

export const UniversalStorefrontSpecSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  brand: BrandConfigSchema,
  sections: z.array(SectionConfigSchema).min(1),
  animations: z
    .object({
      motionIntensity: z.enum(["subtle", "balanced", "high", "none"]).default("balanced"),
      scrollParallax: z.boolean().default(true),
      cardHoverElevation: z.boolean().default(true),
    })
    .default({
      motionIntensity: "balanced",
      scrollParallax: true,
      cardHoverElevation: true,
    }),
  seo: z.object({
    titleTemplate: z.string().default("%s | Our Store"),
    metaDescription: z.string(),
    ogImage: z.string().url().optional().nullable(),
    keywords: z.array(z.string()).default([]),
  }),
});

export type UniversalStorefrontSpec = z.infer<typeof UniversalStorefrontSpecSchema>;
export type SectionConfig = z.infer<typeof SectionConfigSchema>;
export type SectionType = z.infer<typeof SectionTypeEnum>;
export type BrandConfig = z.infer<typeof BrandConfigSchema>;
export type ThemeColors = z.infer<typeof ThemeColorsSchema>;
export type TypographyTokens = z.infer<typeof TypographyTokensSchema>;
