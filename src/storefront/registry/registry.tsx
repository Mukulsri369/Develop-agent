import type { ComponentType, ReactNode } from "react";
import type { SectionConfig, SectionType } from "../design/schema";
import type { RegistryEntry, SectionComponentProps } from "./types";
import { ProductScrollRail } from "@/components/store/ProductScrollRail";
import { CategoryQualityBento } from "@/components/store/CategoryQualityBento";
import { PlanetHero } from "@/components/store/PlanetHero";

const registry = new Map<SectionType, RegistryEntry>();

export function FallbackSection({ config }: SectionComponentProps): ReactNode {
  return (
    <div
      data-testid="unsupported-section"
      className="mx-auto my-8 max-w-7xl rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground"
    >
      <span className="font-mono text-xs uppercase tracking-wider text-accent">
        [Section: {config.type}]
      </span>
      <p className="mt-1">This section is not available or is unsupported in this preview.</p>
    </div>
  );
}

export function registerSectionComponent(entry: RegistryEntry): void {
  registry.set(entry.type, entry);
}

export function getSectionComponent(type: SectionType): ComponentType<SectionComponentProps> {
  const entry = registry.get(type);
  return entry ? entry.component : FallbackSection;
}

export function isRegisteredSection(type: string): boolean {
  return registry.has(type as SectionType);
}

// Wrapper for ProductScrollRail adapting SectionComponentProps
function RegisteredProductsRail({ config, products = [] }: SectionComponentProps) {
  return (
    <section id={config.id} className="py-8">
      <ProductScrollRail
        title={config.headline || "Featured Discoveries"}
        subtitle={config.subheadline || "Curated for curious minds"}
        products={products}
      />
    </section>
  );
}

// Wrapper for CategoryQualityBento adapting SectionComponentProps
function RegisteredCategoryBento({ config }: SectionComponentProps) {
  return (
    <section id={config.id} className="py-8">
      <CategoryQualityBento
        title={config.headline || "Explore Categories"}
        subtitle={config.subheadline || "Browse our celestial collections"}
      />
    </section>
  );
}

// Wrapper for PlanetHero adapting SectionComponentProps
function RegisteredPlanetHero({ config }: SectionComponentProps) {
  return (
    <section id={config.id}>
      <PlanetHero />
    </section>
  );
}

// Initialize registry with core verified components
registerSectionComponent({
  type: "featured_products_rail",
  label: "Featured Products Rail",
  component: RegisteredProductsRail,
});

registerSectionComponent({
  type: "category_bento_grid",
  label: "Category Bento Grid",
  component: RegisteredCategoryBento,
});

registerSectionComponent({
  type: "planet_hero_carousel",
  label: "Astronomy Planet Hero Carousel",
  component: RegisteredPlanetHero,
  supportedIndustries: ["astronomy_space"],
});
