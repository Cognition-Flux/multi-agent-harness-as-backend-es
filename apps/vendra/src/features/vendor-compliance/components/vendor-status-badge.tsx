"use client";

/**
 * The 7-state compliance badge (SPEC §3.3), including a deliberate
 * out-of-enum "Unknown" fallback. Every state carries a status
 * dot; IN_PROGRESS (live agent sessions) wears the agent variant with a
 * pulsing dot, and EXPIRED swaps the dot for a clock glyph so a lapsed state
 * reads differently from action-needed NEED_REVIEW on the same warning token.
 */
import { ClockIcon } from "lucide-react";

import { Badge } from "@/components/ui/primitives";

const DESCRIPTORS: Record<
  string,
  {
    label: string;
    variant: "muted" | "secondary" | "default" | "warning" | "destructive" | "success" | "agent";
    /** Live agent sessions running — the only state that earns motion. */
    pulse?: boolean;
    /** Lapsed credential: a clock glyph replaces the status dot. */
    clock?: boolean;
  }
> = {
  NOT_STARTED: { label: "Not started", variant: "muted" },
  IN_PROGRESS: { label: "In progress", variant: "agent", pulse: true },
  PRE_APPROVED: { label: "Likely compliant", variant: "default" },
  NEED_REVIEW: { label: "Needs review", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  EXPIRED: { label: "Expired", variant: "warning", clock: true },
};

/** The badge's human label for a status token — one copy source everywhere. */
export function vendorStatusLabel(status: string): string {
  return DESCRIPTORS[status]?.label ?? "Unknown";
}

export function VendorStatusBadge({ status }: { status: string }) {
  const descriptor = DESCRIPTORS[status] ?? {
    label: "Unknown",
    variant: "muted" as const,
  };
  return (
    <Badge variant={descriptor.variant} dot={!descriptor.pulse && !descriptor.clock}>
      {descriptor.pulse ? (
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
      ) : null}
      {descriptor.clock ? <ClockIcon aria-hidden className="h-3 w-3 shrink-0" /> : null}
      {descriptor.label}
    </Badge>
  );
}
