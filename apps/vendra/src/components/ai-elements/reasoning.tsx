"use client";

/**
 * Vendored AI Elements `<Reasoning>` — the collapsible thinking block for
 * `reasoning` parts (streamed via `sendReasoning: true`). Auto-opens while
 * streaming, collapses shortly after it ends. API mirrors the upstream
 * registry component, adapted to this repo's theme tokens.
 */
import { ChevronRight, Lightbulb } from "lucide-react";
import type { HTMLAttributes } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { TextShimmer } from "./shimmer";

interface ReasoningContextValue {
  reasoning: string;
  isOpen: boolean;
  isStreaming: boolean;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoning(): ReasoningContextValue {
  const ctx = useContext(ReasoningContext);
  if (!ctx) {
    throw new Error("Reasoning sub-components must be used within <Reasoning>");
  }
  return ctx;
}

export interface ReasoningProps extends HTMLAttributes<HTMLDivElement> {
  /** The concatenated reasoning/thinking text. */
  reasoning: string;
  /** Streaming state — drives the trigger shimmer (and auto-open when on). */
  isStreaming?: boolean;
  defaultOpen?: boolean;
  /**
   * Auto-open while streaming + auto-collapse after (upstream behavior).
   * Off = collapsed-by-default (SPEC §17 C8): the shimmering trigger still
   * signals activity; the user opens the text on demand and their choice
   * is never overridden.
   */
  autoOpen?: boolean;
}

export function Reasoning({
  reasoning,
  isStreaming = false,
  defaultOpen,
  autoOpen = false,
  className,
  children,
  ...props
}: ReasoningProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? (autoOpen && isStreaming));

  useEffect(() => {
    if (!autoOpen) return;
    if (isStreaming) {
      setIsOpen(true);
    } else if (reasoning) {
      const timer = setTimeout(() => setIsOpen(false), 800);
      return () => clearTimeout(timer);
    }
  }, [autoOpen, isStreaming, reasoning]);

  const value = useMemo(
    () => ({ reasoning, isOpen, isStreaming }),
    [reasoning, isOpen, isStreaming],
  );

  if (!reasoning) return null;

  return (
    <ReasoningContext.Provider value={value}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen} asChild>
        <div
          data-slot="reasoning"
          className={cn("rounded-md border border-border/60 bg-muted/20 text-sm", className)}
          {...props}
        >
          {children}
        </div>
      </Collapsible>
    </ReasoningContext.Provider>
  );
}

export type ReasoningTriggerProps = HTMLAttributes<HTMLButtonElement>;

export function ReasoningTrigger({ className, children, ...props }: ReasoningTriggerProps) {
  const { isOpen, isStreaming } = useReasoning();
  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        data-slot="reasoning-trigger"
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 data-[state=open]:rounded-b-none data-[state=open]:bg-agent/5",
          className,
        )}
        {...props}
      >
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-agent" aria-hidden />
        {children ??
          (isStreaming ? (
            <TextShimmer>Pensando…</TextShimmer>
          ) : (
            <span>Proceso de razonamiento</span>
          ))}
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            isOpen && "rotate-90",
          )}
          aria-hidden
        />
      </button>
    </CollapsibleTrigger>
  );
}

export type ReasoningContentProps = HTMLAttributes<HTMLDivElement>;

export function ReasoningContent({ className, children, ...props }: ReasoningContentProps) {
  const { reasoning } = useReasoning();
  return (
    <CollapsibleContent>
      <div
        data-slot="reasoning-content"
        className={cn(
          "max-h-60 overflow-y-auto whitespace-pre-wrap border-t border-border/40 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground",
          className,
        )}
        {...props}
      >
        {children ?? reasoning}
        <div
          aria-hidden
          className="pointer-events-none sticky bottom-0 -mt-4 h-4 bg-gradient-to-t from-background to-transparent"
        />
      </div>
    </CollapsibleContent>
  );
}
