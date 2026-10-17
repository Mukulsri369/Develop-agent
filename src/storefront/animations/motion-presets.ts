import type { Transition } from "motion/react";

/**
 * Standard cubic bezier easing curves used across the platform.
 */
export const EASINGS = {
  smoothOut: [0.16, 1, 0.3, 1] as const,
  gentle: [0.25, 0.1, 0.25, 1] as const,
  anticipate: [0.36, 0, 0.66, -0.56] as const,
  snappy: [0.4, 0, 0.2, 1] as const,
};

export const TRANSITIONS: Record<string, Transition> = {
  fade: {
    duration: 0.35,
    ease: EASINGS.smoothOut,
  },
  springSnappy: {
    type: "spring",
    stiffness: 260,
    damping: 24,
  },
  cardHover: {
    duration: 0.25,
    ease: EASINGS.smoothOut,
  },
};

/**
 * Checks if the user environment requests reduced motion.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
