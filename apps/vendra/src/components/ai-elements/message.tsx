"use client";

import type { UIMessage } from "ai";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type MessageProps = ComponentProps<"div"> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full animate-fade-in-up flex-col gap-1",
      from === "user" ? "items-end" : "items-start",
      className,
    )}
    data-role={from}
    data-slot="message"
    {...props}
  />
);

export type MessageContentProps = ComponentProps<"div">;

export const MessageContent = ({
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex min-w-0 flex-col gap-2 overflow-hidden text-sm",
      // User bubble: tailored corners + soft brand gradient (white on primary
      // is 6.8:1, so AA holds across the from-primary → to-primary/85 sweep).
      "group-data-[role=user]:max-w-[85%] group-data-[role=user]:rounded-2xl group-data-[role=user]:rounded-br-md group-data-[role=user]:bg-gradient-to-br group-data-[role=user]:from-primary group-data-[role=user]:to-primary/85 group-data-[role=user]:px-3 group-data-[role=user]:py-2 group-data-[role=user]:text-primary-foreground group-data-[role=user]:shadow-sm group-data-[role=user]:shadow-primary/20",
      "group-data-[role=assistant]:w-full group-data-[role=assistant]:max-w-prose group-data-[role=assistant]:rounded-lg group-data-[role=assistant]:text-foreground",
      className,
    )}
    data-slot="message-content"
    {...props}
  />
);
