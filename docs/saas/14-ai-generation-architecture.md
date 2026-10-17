# 14 — AI Design Engine & Gemini Generation Pipeline

## 1. AI Generation Engine Overview

The AI Design Engine translates customer natural language prompts (e.g., _"Create a sleek, dark-mode sneakerhead boutique called Nocturnal Kicks with neon lime accents, an interactive particle grid, and editorial typography"_) into a fully validated, production-grade **Universal Storefront Specification (USS)**.

All AI interactions run strictly **server-side** using the official Google Gen AI SDK (`@google/genai`). No API keys or LLM requests ever touch client bundles.

---

## 2. End-to-End Generation & Refinement Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AI GENERATION PIPELINE                          │
├────────────────────────────────────────────────────────────────────────┤
│ 1. USER INPUT                                                          │
│    Creator inputs natural language prompt + optional brand assets      │
│    ▼                                                                   │
│ 2. INPUT SANITIZATION & QUOTA VERIFICATION                             │
│    Validate token limits, verify subscription AI credits               │
│    ▼                                                                   │
│ 3. GEMINI STRUCTURED GENERATION (`gemini-2.5-pro` / `gemini-2.5-flash`) │
│    Enforces JSON Schema mode using `UniversalStorefrontSpecSchema`     │
│    ▼                                                                   │
│ 4. STRICT ZOD VALIDATION & COMPONENT MATCHING                          │
│    Validates typography, hex colors, and registry component types      │
│    ▼                                                                   │
│ 5. DESIGN ASSET SYNTHESIS                                              │
│    Generates placeholder imagery or background textures if needed      │
│    ▼                                                                   │
│ 6. DRAFT STORE DESIGN STORAGE                                          │
│    Saved to `public.store_designs.draft_spec`                          │
│    ▼                                                                   │
│ 7. LIVE IFRAME PREVIEW IN ADMIN CONSOLE                                │
│    Creator evaluates generated store in real time                      │
│    ▼                                                                   │
│ 8. CONVERSATIONAL REFINEMENT OR PUBLISHING                             │
│    Section-by-section diff updates or one-click publish                │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Server-Side Model Integration & Structured Output

### Secure API Implementation Pattern (`src/lib/ai/designer.ts`)

```typescript
import { GoogleGenAI, Type } from "@google/genai";
import { UniversalStorefrontSpecSchema, type UniversalStorefrontSpec } from "@/lib/theme/schema";

// Server-side initialization with process.env.GEMINI_API_KEY
const ai = new GoogleGenAI();

export async function generateStorefrontDesign(params: {
  storeName: string;
  nichePrompt: string;
  industryHint?: string;
}): Promise<UniversalStorefrontSpec> {
  const systemInstruction = `
You are the world's elite digital brand director and storefront architect.
Generate a cohesive, distinctive, production-grade Universal Storefront Specification.

Rules:
1. Select harmonious color palettes with high-contrast text ratios (WCAG AA).
2. Choose typography suited to the brand personality (e.g. Instrument Serif for luxury, JetBrains Mono for tech).
3. Compose sections in a logical ecommerce storytelling hierarchy:
   Hero -> Featured Products Rail -> Category Bento Grid -> Brand Story -> FAQ -> Footer.
4. Only select components that exist in the approved Component Registry.
5. Never invent component names outside the schema.
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Store Name: "${params.storeName}"\nDesign Brief: "${params.nichePrompt}"\nIndustry Hint: "${params.industryHint || "auto-detect"}"`,
          },
        ],
      },
    ],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      // Enforce deterministic schema matching the Universal Storefront Specification
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          schemaVersion: { type: Type.STRING, enum: ["1.0.0"] },
          brand: {
            type: Type.OBJECT,
            properties: {
              storeName: { type: Type.STRING },
              tagline: { type: Type.STRING },
              industry: {
                type: Type.STRING,
                enum: [
                  "astronomy_space",
                  "luxury_fashion",
                  "streetwear_sneakers",
                  "consumer_electronics",
                  "home_decor",
                  "beauty_cosmetics",
                  "outdoor_adventure",
                  "general_retail",
                ],
              },
              personality: {
                type: Type.STRING,
                enum: [
                  "cinematic_cosmic",
                  "editorial_luxury",
                  "neo_brutalist",
                  "clean_minimalist",
                  "warm_organic",
                  "cyber_high_tech",
                ],
              },
              colors: {
                type: Type.OBJECT,
                properties: {
                  primary: { type: Type.STRING },
                  primaryForeground: { type: Type.STRING },
                  secondary: { type: Type.STRING },
                  secondaryForeground: { type: Type.STRING },
                  background: { type: Type.STRING },
                  foreground: { type: Type.STRING },
                  card: { type: Type.STRING },
                  cardForeground: { type: Type.STRING },
                  muted: { type: Type.STRING },
                  mutedForeground: { type: Type.STRING },
                  accent: { type: Type.STRING },
                  border: { type: Type.STRING },
                  ring: { type: Type.STRING },
                },
                required: ["primary", "background", "foreground", "accent", "card", "border"],
              },
              typography: {
                type: Type.OBJECT,
                properties: {
                  headingFont: {
                    type: Type.STRING,
                    enum: [
                      "Instrument Serif",
                      "Prata",
                      "Cinzel",
                      "Syne",
                      "Plus Jakarta Sans",
                      "Manrope",
                      "JetBrains Mono",
                      "Space Grotesk",
                    ],
                  },
                  bodyFont: { type: Type.STRING, enum: ["Manrope", "Plus Jakarta Sans", "Inter"] },
                  monoFont: { type: Type.STRING, enum: ["JetBrains Mono", "Space Mono"] },
                  headingWeight: {
                    type: Type.STRING,
                    enum: ["normal", "medium", "semibold", "bold"],
                  },
                  letterSpacing: { type: Type.STRING, enum: ["tight", "normal", "wide", "widest"] },
                  textTransform: { type: Type.STRING, enum: ["none", "uppercase", "capitalize"] },
                },
                required: ["headingFont", "bodyFont", "monoFont"],
              },
              cornerStyle: { type: Type.STRING, enum: ["sharp", "soft", "rounded", "full"] },
            },
            required: ["storeName", "tagline", "industry", "personality", "colors", "typography"],
          },
          background: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                enum: ["solid", "gradient_mesh", "starfield", "subtle_grid", "noise_grain"],
              },
              intensity: { type: Type.NUMBER },
              opacity: { type: Type.NUMBER },
            },
            required: ["type"],
          },
          three: {
            type: Type.OBJECT,
            properties: {
              sceneType: {
                type: Type.STRING,
                enum: [
                  "none",
                  "galaxy_particles",
                  "floating_mesh_grid",
                  "cyber_cubes",
                  "soft_orbs",
                ],
              },
              particleCount: { type: Type.INTEGER },
              primaryColor: { type: Type.STRING },
              secondaryColor: { type: Type.STRING },
              interactiveControl: { type: Type.BOOLEAN },
            },
            required: ["sceneType"],
          },
          animations: {
            type: Type.OBJECT,
            properties: {
              motionIntensity: { type: Type.STRING, enum: ["subtle", "balanced", "high", "none"] },
              scrollParallax: { type: Type.BOOLEAN },
              cardHoverElevation: { type: Type.BOOLEAN },
            },
            required: ["motionIntensity"],
          },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: {
                  type: Type.STRING,
                  enum: [
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
                  ],
                },
                visible: { type: Type.BOOLEAN },
                order: { type: Type.INTEGER },
                headline: { type: Type.STRING },
                subheadline: { type: Type.STRING },
                badgeText: { type: Type.STRING },
              },
              required: ["id", "type", "visible", "order"],
            },
          },
          seo: {
            type: Type.OBJECT,
            properties: {
              titleTemplate: { type: Type.STRING },
              metaDescription: { type: Type.STRING },
              keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["titleTemplate", "metaDescription"],
          },
        },
        required: [
          "schemaVersion",
          "brand",
          "background",
          "three",
          "animations",
          "sections",
          "seo",
        ],
      },
    },
  });

  const parsedJson = JSON.parse(response.text.trim());
  // Double-verify against runtime Zod schema
  return UniversalStorefrontSpecSchema.parse(parsedJson);
}
```

---

## 4. Conversational Refinement & Section Regeneration

Rather than forcing the creator to regenerate the entire storefront from scratch to change one color or header, the AI engine supports **targeted diff operations**:

1. **Section-Level Update**:
   ```typescript
   export async function refineSection(
     currentSpec: UniversalStorefrontSpec,
     sectionId: string,
     userInstruction: string,
   ): Promise<UniversalStorefrontSpec>;
   ```
   Gemini receives the current JSON for that specific section alongside the user's critique (e.g., _"Make the headline bolder and showcase the Summer Collection instead"_). It returns only the updated section object.
2. **Palette-Only Refinement**:
   Adjusts `--color-primary` or `--font-display` without shifting section order or replacing existing copy.
3. **Immutable Version Checkpoints**:
   Every successful generation creates a record in `public.store_design_versions` with an auto-incrementing version number. If the user dislikes a prompt result, one-click rollback restores the previous version.

---

## 5. Safety & Defense Against Hallucinations

1. **Strict Type Confinement**: Because Gemini returns structured JSON validated by Zod, the AI cannot inject `<script>` tags, malicious `eval()` calls, or unapproved npm libraries.
2. **Graceful Handling of Unsupported Requests**:
   If a user asks for something outside the registry (e.g. _"Build an auction bidding engine"_ or _"Add a 3D avatar customizer"_), the prompt analyst intercepts the request and politely explains that the current platform supports affiliate commerce and curated storefronts, recommending an alternative supported layout.
