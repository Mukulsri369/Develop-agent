import type { ComponentType } from "react";
import type { SectionConfig, SectionType } from "../design/schema";
import type { ProductCardData } from "@/lib/store";

export interface SectionComponentProps {
  config: SectionConfig;
  products?: ProductCardData[];
  className?: string;
}

export interface RegistryEntry {
  type: SectionType;
  label: string;
  component: ComponentType<SectionComponentProps>;
  supportedIndustries?: string[];
  defaultProps?: Record<string, unknown>;
}
