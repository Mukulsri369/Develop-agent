# 20 — Universal Design Specification & Component Registry Contracts

## 1. Specification Contract Definition

The Universal Storefront Specification (USS) is defined in `src/storefront/design/schema.ts` using Zod. It serves as the formal contract between future AI generation engines and the storefront rendering runtime.

### Core Schema Modules

1. **Schema Versioning**:
   - `schemaVersion: z.literal("1.0.0")` ensures forward compatibility.
2. **Brand & Theme Identity**:
   - `industry`: Restricts to 8 supported ecommerce categories (`astronomy_space`, `luxury_fashion`, `streetwear_sneakers`, `consumer_electronics`, `home_decor`, `beauty_cosmetics`, `outdoor_adventure`, `general_retail`).
   - `personality`: Controls styling archetype (`cinematic_cosmic`, `editorial_luxury`, `neo_brutalist`, `clean_minimalist`, `warm_organic`, `cyber_high_tech`).
   - `colors`: 13 color tokens (`primary`, `secondary`, `background`, `foreground`, `accent`, `card`, `border`, `ring`, etc.).
   - `typography`: Verified Google Fonts for headings, body, and monospace elements with explicit weight and tracking tokens.
   - `cornerStyle`: Border radius archetype (`sharp`, `soft`, `rounded`, `full`).
3. **Sections Composition**:
   - Array of `SectionConfig` objects defining `id`, `type`, `visible`, `order`, headline strings, and dynamic `contentBinding`.
4. **Animation & 3D Parameters**:
   - Controls motion intensity, scroll parallax, and interactive WebGL scene settings.

---

## 2. Component Registry Contract

Implemented in `src/storefront/registry/registry.tsx`:

### Approved Section Identifiers

- `editorial_hero`
- `cinematic_hero`
- `video_showcase_hero`
- `planet_hero_carousel` (Astronomy)
- `featured_products_rail`
- `category_bento_grid`
- `product_spotlight_split`
- `brand_story_editorial`
- `three_scene_interactive`
- `promotional_banner`
- `faq_accordion`
- `footer_multicolumn`
- `footer_minimal`

### Registry Safety Rules

1. **No Arbitrary Code Execution**: The registry only executes pre-compiled, type-checked React components registered in TypeScript source code. AI models cannot supply raw JSX or eval strings.
2. **Graceful Fallback Protection**: If an unsupported, experimental, or corrupt section identifier is requested, `getSectionComponent()` returns `<FallbackSection />` which renders an isolated notification box rather than crashing the page.
