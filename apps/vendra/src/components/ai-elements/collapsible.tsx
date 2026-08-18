"use client";

/**
 * The shadcn-style collapsible primitive the vendored AI Elements share
 * (Radix under the hood — the same primitive upstream AI Elements use).
 * Height animation lives here once so every Tool/Task/Reasoning open/close
 * inherits it; the reduced-motion kill-switch in globals.css disarms it.
 */
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;

export function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      className={cn(
        "overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
        className,
      )}
      {...props}
    />
  );
}
