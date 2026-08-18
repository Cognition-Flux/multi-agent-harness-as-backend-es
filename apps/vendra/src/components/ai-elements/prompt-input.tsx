"use client";

import type { ChatStatus } from "ai";
import type { ComponentProps, FormEvent, KeyboardEvent } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";

import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type PromptInputProps = Omit<ComponentProps<"form">, "onSubmit"> & {
  onSubmit: () => void;
};

export const PromptInput = ({
  className,
  onSubmit,
  ...props
}: PromptInputProps) => (
  <form
    className={cn(
      "flex items-end gap-2 rounded-lg border border-input bg-background p-2 shadow-soft transition-all duration-200 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
      className,
    )}
    data-slot="prompt-input"
    onSubmit={(e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      onSubmit();
    }}
    {...props}
  />
);

export type PromptInputTextareaProps = ComponentProps<"textarea"> & {
  /** Fired on Enter (Shift+Enter inserts a newline). */
  onEnterSubmit: () => void;
};

export const PromptInputTextarea = ({
  className,
  onEnterSubmit,
  ...props
}: PromptInputTextareaProps) => (
  <textarea
    className={cn(
      "max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    data-slot="prompt-input-textarea"
    onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        onEnterSubmit();
      }
    }}
    rows={1}
    {...props}
  />
);

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status: ChatStatus;
  /** Wired to useChat().stop — shown while a reply is in flight. */
  onStop: () => void;
};

// One button, two states: the send arrow cross-fades into the stop square
// (no variant flip), and a pulsing agent-accent ring marks the live-streaming
// state. Submit vs stop semantics (type/onClick/aria-label) are unchanged.
export const PromptInputSubmit = ({
  className,
  status,
  onStop,
  disabled,
  ...props
}: PromptInputSubmitProps) => {
  const busy = status === "submitted" || status === "streaming";
  return (
    <Button
      aria-label={busy ? "Detener la generación" : "Enviar mensaje"}
      className={cn(
        "relative h-9 w-9 shrink-0 rounded-md p-0 transition-all duration-300",
        className,
      )}
      disabled={busy ? undefined : disabled}
      onClick={busy ? onStop : undefined}
      size="sm"
      type={busy ? "button" : "submit"}
      {...props}
    >
      {busy && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-pulse rounded-md ring-2 ring-agent/30"
        />
      )}
      <ArrowUpIcon
        aria-hidden
        className={cn(
          "absolute h-4 w-4 transition-all duration-300",
          busy ? "scale-50 opacity-0" : "scale-100 opacity-100",
        )}
      />
      <SquareIcon
        aria-hidden
        className={cn(
          "absolute h-3.5 w-3.5 transition-all duration-300",
          busy ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0",
        )}
      />
    </Button>
  );
};
