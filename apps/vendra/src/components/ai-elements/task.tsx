"use client";

/**
 * Vendored AI Elements `<Task>` — the collapsible task-progress primitive
 * (the pipeline-stage checklist). API mirrors the upstream registry
 * component, adapted to this repo's theme tokens, plus a small
 * `<TaskItemStatus>` helper for per-item state icons.
 */
import { CheckCircle2, ChevronDown, ListChecks, Loader2 } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

export type TaskProps = ComponentProps<typeof Collapsible> & { className?: string };

export function Task({ defaultOpen = true, className, ...props }: TaskProps) {
  return <Collapsible defaultOpen={defaultOpen} className={cn(className)} {...props} />;
}

export interface TaskTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  title: string;
  icon?: ReactNode;
  /** Completed-item count for the optional "done/total" counter pill. */
  done?: number;
  /** Total-item count for the optional "done/total" counter pill. */
  total?: number;
}

export function TaskTrigger({ title, icon, done, total, className, ...props }: TaskTriggerProps) {
  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        data-slot="task-trigger"
        className={cn(
          "group flex w-full items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
          className,
        )}
        {...props}
      >
        {icon ?? <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        <span>{title}</span>
        {typeof done === "number" && typeof total === "number" && (
          <span
            className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
            data-slot="task-trigger-counter"
          >
            {done}/{total}
          </span>
        )}
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </button>
    </CollapsibleTrigger>
  );
}

export type TaskContentProps = ComponentProps<typeof CollapsibleContent> & {
  className?: string;
};

export function TaskContent({ children, className, ...props }: TaskContentProps) {
  return (
    <CollapsibleContent className={cn(className)} {...props}>
      <div className="mt-2 space-y-1 border-l-2 border-agent/30 pl-3">{children}</div>
    </CollapsibleContent>
  );
}

export type TaskItemState = "done" | "active" | "pending";

export interface TaskItemProps extends HTMLAttributes<HTMLDivElement> {
  state?: TaskItemState;
}

// Pending rows keep full-opacity muted-foreground text (AA-safe); the
// "not started yet" faintness is carried by the icon alone.
export function TaskItem({ state, className, children, ...props }: TaskItemProps) {
  return (
    <div
      data-slot="task-item"
      className={cn(
        "flex items-center gap-1.5 text-xs",
        state === "done"
          ? "text-muted-foreground"
          : state === "active"
            ? "-mx-1.5 rounded-md bg-agent/5 px-1.5 font-medium text-foreground"
            : "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {state === "done" ? (
        <CheckCircle2 className="h-3 w-3 shrink-0 animate-scale-in text-success" aria-hidden />
      ) : state === "active" ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-agent" aria-hidden />
      ) : (
        <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-muted-foreground/30" aria-hidden />
      )}
      {children}
    </div>
  );
}
