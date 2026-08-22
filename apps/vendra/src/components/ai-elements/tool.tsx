"use client";

/**
 * Vendored AI Elements `<Tool>` — the collapsible tool-invocation primitive
 * that renders the AI SDK tool-part state machine (input-streaming →
 * input-available → output-available | output-error). API mirrors the
 * upstream `ai-elements` registry component, adapted to this repo's theme
 * tokens; the abstract state-machine pattern is owned by the
 * ai-sdk-generative-ui skill.
 */
import { CheckCircle2, ChevronRight, CircleDot, Loader2, ShieldAlert, Wrench, XCircle } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { TextShimmer } from "./shimmer";

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

const STATUS_CONFIG: Record<
  ToolState,
  { icon: ReactNode; label: string; className: string }
> = {
  "input-streaming": {
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: "Pendiente",
    className: "text-agent bg-agent/10",
  },
  "input-available": {
    icon: <CircleDot className="h-3 w-3" />,
    label: "En ejecución",
    className: "text-agent bg-agent/10",
  },
  "approval-requested": {
    icon: <ShieldAlert className="h-3 w-3" />,
    label: "En espera de aprobación",
    className: "text-warning bg-warning/10",
  },
  "approval-responded": {
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: "Respondido",
    className: "text-muted-foreground bg-muted",
  },
  "output-available": {
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: "Completado",
    className: "text-success bg-success/10",
  },
  "output-error": {
    icon: <XCircle className="h-3 w-3" />,
    label: "Error",
    className: "text-destructive bg-destructive/10",
  },
  "output-denied": {
    icon: <XCircle className="h-3 w-3" />,
    label: "Denegado",
    className: "text-destructive bg-destructive/10",
  },
};

// Per-state left accent for the header rail, so a tool's outcome reads at a
// glance even while collapsed. Decorative only (never carries text), so the
// live lanes may use the agent accent per the semantic color law.
const STATE_ACCENT: Record<ToolState, string> = {
  "input-streaming": "border-l-agent/60",
  "input-available": "border-l-agent/60",
  "approval-requested": "border-l-warning/60",
  "approval-responded": "border-l-border",
  "output-available": "border-l-success/60",
  "output-error": "border-l-destructive/60",
  "output-denied": "border-l-destructive/60",
};

export function getToolStatusBadge(state: ToolState): ReactNode {
  const config = STATUS_CONFIG[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-300",
        config.className,
      )}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

export interface ToolProps extends HTMLAttributes<HTMLDivElement> {
  defaultOpen?: boolean;
}

export function Tool({ defaultOpen = false, className, children, ...props }: ToolProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
      <div
        data-slot="tool"
        className={cn("rounded-md border border-border/60 bg-muted/20 text-sm", className)}
        {...props}
      >
        {children}
      </div>
    </Collapsible>
  );
}

/** "saveClassification" → "Save Classification" */
function formatToolName(name: string): string {
  return name
    .replace(/^tool-/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface ToolHeaderProps extends HTMLAttributes<HTMLButtonElement> {
  /** The tool part type or bare tool name, e.g. "tool-saveClassification". */
  type: string;
  state: ToolState;
  title?: string;
}

export function ToolHeader({ type, state, title, className, ...props }: ToolHeaderProps) {
  const name = title ?? formatToolName(type);
  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        data-slot="tool-header"
        className={cn(
          "flex w-full items-center gap-2 rounded-md border-l-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
          STATE_ACCENT[state],
          className,
        )}
        {...props}
      >
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {state === "input-streaming" ? (
          <TextShimmer className="font-medium">{name}</TextShimmer>
        ) : (
          <span className="font-medium text-foreground">{name}</span>
        )}
        {getToolStatusBadge(state)}
        <ChevronRight
          className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-90"
          aria-hidden
        />
      </button>
    </CollapsibleTrigger>
  );
}

export type ToolContentProps = HTMLAttributes<HTMLDivElement>;

export function ToolContent({ className, children, ...props }: ToolContentProps) {
  return (
    <CollapsibleContent>
      <div
        data-slot="tool-content"
        className={cn("border-t border-border/40 px-2.5 py-2 text-xs", className)}
        {...props}
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}

export interface ToolInputProps extends HTMLAttributes<HTMLDivElement> {
  input?: unknown;
}

export function ToolInput({ input, className, ...props }: ToolInputProps) {
  if (
    input === undefined ||
    input === null ||
    (typeof input === "object" && Object.keys(input).length === 0)
  ) {
    return null;
  }
  return (
    <div data-slot="tool-input" className={cn("mb-2", className)} {...props}>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Entrada
      </p>
      <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {JSON.stringify(input, null, 2)}
      </pre>
    </div>
  );
}

export interface ToolOutputProps extends HTMLAttributes<HTMLDivElement> {
  output?: ReactNode;
  errorText?: string;
}

export function ToolOutput({ output, errorText, className, ...props }: ToolOutputProps) {
  if (!output && !errorText) return null;
  return (
    <div data-slot="tool-output" className={cn(className)} {...props}>
      {errorText ? (
        <div className="rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">
          {errorText}
        </div>
      ) : (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Resultado
          </p>
          <div className="text-xs text-muted-foreground">{output}</div>
        </div>
      )}
    </div>
  );
}
