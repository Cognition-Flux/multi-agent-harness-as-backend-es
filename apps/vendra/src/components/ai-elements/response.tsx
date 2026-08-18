"use client";

import { memo } from "react";
import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

export type ResponseProps = {
  children: string;
  className?: string;
};

/**
 * Streaming-markdown renderer for assistant text (Streamdown core only —
 * no code/math/mermaid plugins; the assistant's formatting doctrine is
 * plain paragraphs, bullets, and ≤2-column tables). Memoized on the raw
 * string so a growing stream re-renders only the changed block.
 */
export const Response = memo(
  ({ children, className }: ResponseProps) => (
    <Streamdown
      className={cn(
        "space-y-2 text-sm leading-relaxed",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-agent/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
        "[&_li]:ml-4 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc",
        "[&_table]:w-full [&_th]:border-b [&_th]:border-border/60 [&_th]:py-1 [&_th]:pr-3 [&_th]:text-left [&_th]:font-medium [&_td]:border-b [&_td]:border-border/40 [&_td]:py-1 [&_td]:pr-3",
        className,
      )}
    >
      {children}
    </Streamdown>
  ),
  (prev, next) => prev.children === next.children,
);
Response.displayName = "Response";
