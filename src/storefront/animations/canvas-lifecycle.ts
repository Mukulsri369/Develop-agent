import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion-presets";

export interface CanvasLifecycleOptions {
  pauseOffscreen?: boolean;
  honorReducedMotion?: boolean;
}

/**
 * Reusable hook managing Three.js WebGL canvas lifecycle, viewport visibility,
 * and reduced-motion states to prevent memory leaks and unnecessary GPU utilization.
 */
export function useCanvasLifecycle(options: CanvasLifecycleOptions = {}) {
  const { pauseOffscreen = true, honorReducedMotion = true } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [isReducedMotion, setIsReducedMotion] = useState(false);

  useEffect(() => {
    if (honorReducedMotion && prefersReducedMotion()) {
      setIsReducedMotion(true);
      return;
    }

    if (!pauseOffscreen || typeof IntersectionObserver === "undefined") {
      return;
    }

    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setIsVisible(entry.isIntersecting);
        }
      },
      { rootMargin: "100px 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [pauseOffscreen, honorReducedMotion]);

  return {
    containerRef,
    shouldRender: isVisible && !isReducedMotion,
    isReducedMotion,
  };
}
