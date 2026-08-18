"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type TextShimmerProps = ComponentProps<"span">;

/**
 * Animated text shimmer for in-flight status copy ("Thinking…"). CSS-only:
 * the config's `animate-shimmer` keyframe sweeps a clipped gradient across
 * the glyphs (the block-skeleton variant lives in ui/primitives.tsx).
 *
 * Static-readable fallback: the base color is muted-foreground, and the
 * gradient/clip treatment only applies under `@supports (background-clip:
 * text)` — where clipping is unavailable the label stays plain readable
 * text instead of going invisible (or painting a gradient bar behind the
 * glyphs). The gradient endpoints stay at muted-foreground with a
 * foreground midpoint, so even a paused sweep never dips below AA.
 */
export const TextShimmer = ({
  className,
  children,
  ...props
}: TextShimmerProps) => (
  <span
    className={cn(
      "text-muted-foreground",
      "supports-[background-clip:text]:animate-shimmer supports-[background-clip:text]:bg-gradient-to-r supports-[background-clip:text]:from-muted-foreground supports-[background-clip:text]:via-foreground supports-[background-clip:text]:to-muted-foreground supports-[background-clip:text]:bg-[length:200%_100%] supports-[background-clip:text]:bg-clip-text supports-[background-clip:text]:text-transparent",
      className,
    )}
    data-slot="text-shimmer"
    {...props}
  >
    {children}
  </span>
);
