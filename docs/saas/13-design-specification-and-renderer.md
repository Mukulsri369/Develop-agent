# 13 — Universal Storefront Design Specification & Component Renderer

## 1. Architectural Philosophy: The Design Spec Engine

To allow AI to generate distinct, production-grade storefronts without risking broken code, security holes, or runtime errors, the platform uses a **Declarative Storefront Specification**.

The AI does not write JSX or JavaScript. Instead, it generates a validated **Universal Storefront Specification (USS)** JSON document. The core application contains a hardened, high-performance rendering engine that parses the specification, binds live database queries, and renders validated visual components from the **Component Registry**.

```
┌─────────────────────────────────┐
│   Customer Natural Language     │
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│      Gemini AI Design Engine    │
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│  Universal Storefront Spec      │
│  (Strict Zod / JSON Schema)     │
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│   Theme Token & CSS Injector    │──► Dynamic CSS Variables (--color-primary, etc.)
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│  Component Registry & Renderer  │──► Renders Validated UI Primitives (Hero, Bento, Grid)
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│   Live Storefront Application   │
└─────────────────────────────────┘
```

---

## 2. Complete Zod & TypeScript Specification Schema

```typescript
import { z } from "zod";

// --- 1. BRAND IDENTITY & THEME TOKENS ---
export const ThemeColorTokensSchema = z.object({
  primary: z.string().describe("Main accent color (e.g. hex #E11D48 or oklch)"),
  primaryForeground: z.string().default("#FFFFFF"),
  secondary: z.string(),
  secondaryForeground: z.string(),
  background: z.string().describe("Storefront canvas background (e.g. #0B0D17 or #FAFAF9)"),
  foreground: z.string().describe("Main readable body text color"),
  card: z.string(),
  cardForeground: z.string(),
  muted: z.string(),
  mutedForeground: z.string(),
  accent: z.string().describe("Secondary highlight color (e.g. #06B6D4)"),
  border: z.string(),
  ring: z.string(),
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
  textTransform: z.enum(["none", "uppercase", "capitalize"]).default("none"),
});

export const BrandIdentitySchema = z.object({
  storeName: z.string(),
  tagline: z.string(),
  logoUrl: z.string().url().optional(),
  faviconUrl: z.string().url().optional(),
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
  colors: ThemeColorTokensSchema,
  typography: TypographyTokensSchema,
  cornerStyle: z.enum(["sharp", "soft", "rounded", "full"]).default("rounded"),
});

// --- 2. 3D & GRAPHICS SPECIFICATION ---
export const ThreeVisualSpecSchema = z.object({
  sceneType: z.enum([
    "none",
    "galaxy_particles",
    "floating_mesh_grid",
    "cyber_cubes",
    "soft_orbs",
    "turntable_stage",
  ]),
  particleCount: z.number().min(200).max(3000).default(1200),
  primaryColor: z.string().default("#38bdf8"),
  secondaryColor: z.string().default("#f59e0b"),
  interactiveControl: z.boolean().default(true),
  performancePreset: z.enum(["low", "medium", "high"]).default("medium"),
});

export const BackgroundEffectSchema = z.object({
  type: z.enum([
    "solid",
    "gradient_mesh",
    "starfield",
    "subtle_grid",
    "noise_grain",
    "animated_rings",
  ]),
  intensity: z.number().min(0).max(1).default(0.5),
  opacity: z.number().min(0).max(1).default(0.4),
});

// --- 3. ANIMATION SETTINGS ---
export const AnimationSettingsSchema = z.object({
  motionIntensity: z.enum(["subtle", "balanced", "high", "none"]).default("balanced"),
  scrollParallax: z.boolean().default(true),
  cardHoverElevation: z.boolean().default(true),
  carouselAutoAdvance: z.boolean().default(false),
  transitionDuration: z.number().default(0.3),
});

// --- 4. SECTION COMPOSITION ---
export const SectionTypeSchema = z.enum([
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
  type: SectionTypeSchema,
  visible: z.boolean().default(true),
  order: z.number(),
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
      limit: z.number().default(8),
    })
    .optional(),
  customProps: z.record(z.unknown()).default({}),
});

// --- UNIVERSAL STOREFRONT SPECIFICATION (ROOT) ---
export const UniversalStorefrontSpecSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  brand: BrandIdentitySchema,
  background: BackgroundEffectSchema,
  three: ThreeVisualSpecSchema,
  animations: AnimationSettingsSchema,
  sections: z.array(SectionConfigSchema),
  seo: z.object({
    titleTemplate: z.string().default("%s | Our Store"),
    metaDescription: z.string(),
    ogImage: z.string().url().optional(),
    keywords: z.array(z.string()).default([]),
  }),
});

export type UniversalStorefrontSpec = z.infer<typeof UniversalStorefrontSpecSchema>;
```

---

## 3. The Universal Component Registry

The component registry defines the approved, hardened UI implementations that correspond to `SectionTypeSchema`. Unsupported component names are automatically rejected at schema validation time:

| Section Type                  | Target Industry Niches                    | Visual Characteristics & Layout                                                                                    |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **`editorial_hero`**          | Luxury Fashion, Cosmetics, Interior Décor | Full-bleed editorial typography (`Instrument Serif`), asymmetric photo composition, minimal call-to-action button. |
| **`cinematic_hero`**          | Electronics, Tech, Gaming                 | High-contrast dark background, neon accent glow, live spec badge chips, animated CTA button.                       |
| **`video_showcase_hero`**     | Streetwear, Sneakers, Sports              | Autoplaying muted looping MP4 video with poster fallback and overlay typography.                                   |
| **`planet_hero_carousel`**    | Astronomy & Science (Tenant 0)            | 3-item celestial video and cutout switcher with orbital physics.                                                   |
| **`featured_products_rail`**  | Universal (All Stores)                    | Smooth horizontal carousel with chevron navigation and price badges.                                               |
| **`category_bento_grid`**     | Fashion, Electronics, Home                | Asymmetric bento box highlighting top categories with imagery and hover zoom.                                      |
| **`product_spotlight_split`** | Flagship Launch / Bestseller              | 50/50 split layout with deep product zoom, feature bullets, and Buy Button.                                        |
| **`three_scene_interactive`** | Tech, Astronomy, Sneakers                 | Embedded WebGL container with GPU performance guards and offscreen pausing.                                        |
| **`brand_story_editorial`**   | Ethical Fashion, Artisan Goods            | Pull-quote typography, founder narrative block, and certificate trust badges.                                      |
| **`faq_accordion`**           | Affiliate & Commerce Support              | Radix UI accessible accordion for shipping, affiliate disclosures, and return policies.                            |
| **`footer_multicolumn`**      | Large Multi-Category Stores               | 4-column layout: brand, shop links, legal disclosures, and social icons.                                           |

---

## 4. Theme Token Injection Pipeline

When a storefront loads, `<ThemeTokenProvider spec={spec}>` injects dynamic CSS variables into the root `<head>` style sheet:

```css
:root {
  --color-primary: ${spec.brand.colors.primary};
  --color-primary-foreground: ${spec.brand.colors.primaryForeground};
  --color-secondary: ${spec.brand.colors.secondary};
  --color-background: ${spec.brand.colors.background};
  --color-foreground: ${spec.brand.colors.foreground};
  --color-accent: ${spec.brand.colors.accent};
  --font-display: "${spec.brand.typography.headingFont}", serif;
  --font-sans: "${spec.brand.typography.bodyFont}", sans-serif;
  --radius: ${cornerStyles[spec.brand.cornerStyle]};
}
```

Because Tailwind v4 consumes `@theme inline` variables directly (as configured in `src/styles.css`), all existing utility classes (`bg-primary`, `text-accent`, `font-display`, `rounded-xl`) immediately inherit the tenant's custom aesthetic without regenerating CSS bundles.
