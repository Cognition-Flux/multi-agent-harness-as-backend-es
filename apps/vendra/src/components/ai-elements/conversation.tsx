"use client";

import type { ComponentProps } from "react";
import { ArrowDownIcon } from "lucide-react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

// The library scrolls its Content WRAPPER (where it mounts scrollRef and
// forces overflow:auto), not this root — the root is just the sized box, so
// it must NOT scroll itself. The gradient masks below are siblings of that
// scroller (absolutely positioned in this root), so streamed messages fade
// out softly at both ends of the viewport instead of clipping hard.
export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps) => (
  <StickToBottom
    className={cn("relative min-h-0 flex-1 overflow-hidden", className)}
    data-slot="conversation"
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  >
    {typeof children === "function" ? (
      children
    ) : (
      <>
        {children}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-background to-transparent"
        />
      </>
    )}
  </StickToBottom>
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-3 p-3 sm:p-4", className)}
    data-slot="conversation-content"
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "Aún no hay mensajes",
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-6 text-center sm:p-8",
      className,
    )}
    data-slot="conversation-empty-state"
    {...props}
  >
    {children ?? (
      <>
        {icon && (
          <div
            className="rounded-full bg-agent/10 p-3 text-agent"
            data-slot="conversation-empty-state-icon"
          >
            {icon}
          </div>
        )}
        <div className="space-y-1">
          <h3 className="text-foreground text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-xs">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

// Stays mounted so it can fade/slide instead of popping in and out while a
// reply streams; pointer-events and tabIndex are disabled while hidden.
export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  return (
    <Button
      aria-label="Desplazarse al mensaje más reciente"
      aria-hidden={isAtBottom || undefined}
      className={cn(
        "absolute bottom-4 left-1/2 z-20 h-9 w-9 -translate-x-1/2 rounded-full border-border/60 bg-background/80 p-0 shadow-lift backdrop-blur-md transition-all duration-300 hover:bg-background",
        isAtBottom
          ? "pointer-events-none translate-y-2 opacity-0"
          : "translate-y-0 opacity-100",
        className,
      )}
      data-slot="conversation-scroll-button"
      onClick={() => void scrollToBottom()}
      size="sm"
      tabIndex={isAtBottom ? -1 : 0}
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDownIcon className="h-4 w-4" />
    </Button>
  );
};
