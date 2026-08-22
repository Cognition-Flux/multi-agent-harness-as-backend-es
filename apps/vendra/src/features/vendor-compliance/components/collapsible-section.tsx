"use client";

/**
 * Default-collapsed wrapper for verbose agent-harness output (SPEC §17 C8).
 * The trigger alone keeps the card informative — label + an at-a-glance
 * summary ("9 passed · 1 informational") — while the long-form body opens
 * per-section on demand. Built on the vendored ai-elements Collapsible, so
 * open/close inherits the shared height animation and the reduced-motion
 * kill-switch.
 */
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ai-elements/collapsible";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
  label,
  summary,
  tone = "muted",
  defaultOpen = false,
  children,
  className,
}: {
  label: string;
  /** Short at-a-glance digest shown beside the label while collapsed. */
  summary?: ReactNode;
  tone?: "muted" | "warning";
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
      <div
        data-slot="collapsible-section"
        className={cn(
          "rounded-md border text-xs",
          tone === "warning"
            ? "border-warning/30 bg-warning/10"
            : "border-border/60 bg-muted/20",
          className,
        )}
      >
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
            tone === "warning"
              ? "text-warning hover:bg-warning/10"
              : "text-muted-foreground hover:bg-muted/40",
          )}
        >
          <ChevronRight
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 [[data-state=open]_&]:rotate-90"
          />
          <span>{label}</span>
          {summary ? (
            <span className="ml-auto truncate pl-2 font-normal opacity-80">{summary}</span>
          ) : null}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-2.5 pb-2.5">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
