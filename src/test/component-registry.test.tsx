import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  FallbackSection,
  getSectionComponent,
  isRegisteredSection,
} from "@/storefront/registry/registry";
import type { SectionConfig } from "@/storefront/design/schema";

describe("Component Registry", () => {
  it("confirms registered components are recognized", () => {
    expect(isRegisteredSection("featured_products_rail")).toBe(true);
    expect(isRegisteredSection("category_bento_grid")).toBe(true);
    expect(isRegisteredSection("planet_hero_carousel")).toBe(true);
  });

  it("returns FallbackSection for unknown or unregistered section types", () => {
    expect(isRegisteredSection("unknown_custom_section")).toBe(false);
    // TypeScript cast to test runtime robustness
    const Component = getSectionComponent(
      "unknown_custom_section" as unknown as "featured_products_rail",
    );
    expect(Component).toBe(FallbackSection);
  });

  it("renders FallbackSection without crashing and identifies the section type", () => {
    const mockConfig: SectionConfig = {
      id: "test-sec",
      type: "promotional_banner",
      visible: true,
      order: 1,
      customProps: {},
    };

    render(<FallbackSection config={mockConfig} />);
    expect(screen.getByTestId("unsupported-section")).toBeInTheDocument();
    expect(screen.getByText(/\[Section: promotional_banner\]/i)).toBeInTheDocument();
  });
});
