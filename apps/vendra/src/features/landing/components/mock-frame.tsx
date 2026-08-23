"use client";

/**
 * Shared pieces for the landing's animated product scenes. Visual idioms are
 * copied from the real surfaces: MockFrame is the demo "window", ToolPill
 * mirrors the assistant's tool-activity pills (assistant-chat.tsx), and
 * MockShimmerText mirrors the vendored TextShimmer (shimmer.tsx).
 */

import { CheckIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function MockFrame({
  title,
  badge,
  children,
  className,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glass select-none overflow-hidden rounded-lg shadow-lift", className)}>
      {/* Window chrome */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-card/60 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/40" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/40" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/40" />
        </div>
        <p className="truncate text-xs font-medium text-muted-foreground">{title}</p>
        <div className="flex min-w-6 justify-end">{badge}</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function MiniProgress({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full bg-gradient-to-r from-agent to-[hsl(30_90%_45%)] transition-[width] duration-700 ease-out",
          className,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * The app's TextShimmer idiom: a gradient swept across the glyphs. Every
 * gradient/clip utility is gated behind `supports-[background-clip:text]`
 * (as shimmer.tsx does) so the label degrades to plain readable text where
 * clipping is unavailable, instead of going invisible.
 */
export function MockShimmerText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "text-muted-foreground",
        "supports-[background-clip:text]:animate-shimmer supports-[background-clip:text]:bg-gradient-to-r supports-[background-clip:text]:from-muted-foreground supports-[background-clip:text]:via-foreground supports-[background-clip:text]:to-muted-foreground supports-[background-clip:text]:bg-[length:200%_100%] supports-[background-clip:text]:bg-clip-text supports-[background-clip:text]:text-transparent",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function MockSpinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3 w-3 shrink-0 rounded-full border border-agent border-t-transparent motion-safe:animate-spin",
        className,
      )}
    />
  );
}

/**
 * The assistant's tool-activity pill (role-less here — the scenes are
 * decorative): in-flight shows a spinner + shimmering pending label, done
 * shows a check + finished label in success colors.
 */
export function ToolPill({
  icon: Icon,
  state,
  pending,
  finished,
}: {
  icon: LucideIcon;
  state: "inflight" | "done";
  pending: string;
  finished: string;
}) {
  const done = state === "done";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium",
        done ? "border-success/30 bg-success/10 text-success" : "border-agent/25 bg-agent/5",
      )}
    >
      {done ? <CheckIcon className="h-3 w-3 shrink-0" /> : <MockSpinner />}
      <Icon className={cn("h-3 w-3 shrink-0", done ? "text-success" : "text-agent")} />
      {done ? (
        <span className="truncate">{finished}</span>
      ) : (
        <MockShimmerText className="truncate">{pending}</MockShimmerText>
      )}
    </span>
  );
}

/** Blinking caret for streamed text. */
export function Caret() {
  return (
    <span aria-hidden className="ml-0.5 inline-block h-3 w-[2px] animate-pulse rounded-full bg-agent align-middle" />
  );
}
