import type { ThemeColors, TypographyTokens } from "./schema";

export function generateCssVariables(
  colors: ThemeColors,
  typography: TypographyTokens,
  cornerStyle: "sharp" | "soft" | "rounded" | "full" = "rounded",
): Record<string, string> {
  const radiusMap = {
    sharp: "0px",
    soft: "0.375rem",
    rounded: "0.875rem",
    full: "9999px",
  };

  return {
    "--color-primary": colors.primary,
    "--color-primary-foreground": colors.primaryForeground,
    "--color-secondary": colors.secondary,
    "--color-secondary-foreground": colors.secondaryForeground,
    "--color-background": colors.background,
    "--color-foreground": colors.foreground,
    "--color-card": colors.card,
    "--color-card-foreground": colors.cardForeground,
    "--color-muted": colors.muted,
    "--color-muted-foreground": colors.mutedForeground,
    "--color-accent": colors.accent,
    "--color-border": colors.border,
    "--color-ring": colors.ring,
    "--font-display": `"${typography.headingFont}", serif`,
    "--font-sans": `"${typography.bodyFont}", sans-serif`,
    "--radius": radiusMap[cornerStyle] || radiusMap.rounded,
  };
}
