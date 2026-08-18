"use client";

/**
 * The vendor-assistant conversation: history hydration (plain fetch — the
 * vendor portal deliberately has no react-query provider), the useChat
 * stream against /api/vendor/assistant (send-only-last-message; identity is
 * cookie-implied), and the message render loop — text via Streamdown,
 * reasoning collapsed, host-tool calls as compact activity pills.
 */
import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
// Transports import from `ai` core, NOT @ai-sdk/react.
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai";
import {
  CheckIcon,
  CircleAlertIcon,
  FileSearchIcon,
  LightbulbIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import { TextShimmer } from "@/components/ai-elements/shimmer";
import { Button, Shimmer } from "@/components/ui/primitives";
import type {
  AssistantHistoryResponse,
  VendorAssistantUIMessage,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { ASSISTANT_MAX_MESSAGE_CHARS } from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What's left before I can activate my account?",
  "Why did my document fail?",
  "What documents can I upload?",
];

/** Per-tool activity-pill copy: [in-flight, done]. */
const TOOL_LABELS: Record<string, [string, string]> = {
  getComplianceState: [
    "Checking your compliance record…",
    "Checked your compliance record",
  ],
  getDocumentDetails: ["Reviewing a document…", "Reviewed a document"],
  rememberFacts: ["Noting that down…", "Noted for next time"],
};

const TOOL_ICONS: Record<string, typeof ListChecksIcon> = {
  getComplianceState: ListChecksIcon,
  getDocumentDetails: FileSearchIcon,
  rememberFacts: LightbulbIcon,
};

function ToolPill({
  toolName,
  state,
  live,
}: {
  toolName: string;
  state: string;
  /** False for history-rehydrated parts — never spin for those. */
  live: boolean;
}) {
  const done = state === "output-available";
  const errored = state === "output-error" || state === "output-denied";
  const inFlight = !done && !errored && live;
  const [pending, finished] = TOOL_LABELS[toolName] ?? [
    `Running ${toolName}…`,
    `Ran ${toolName}`,
  ];
  const Icon = TOOL_ICONS[toolName] ?? ListChecksIcon;
  return (
    <span
      aria-live="polite"
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs backdrop-blur-sm transition-colors duration-300",
        errored
          ? "border-destructive/20 bg-destructive/10 text-destructive"
          : done
            ? "border-success/20 bg-success/10 text-success"
            : "border-border/60 bg-muted/60 text-muted-foreground",
      )}
      data-slot="tool-pill"
      role="status"
    >
      <Icon className="h-3.5 w-3.5" />
      {errored ? (
        "That lookup failed"
      ) : inFlight ? (
        <TextShimmer>{pending}</TextShimmer>
      ) : (
        finished
      )}
      {done ? (
        <CheckIcon className="h-3 w-3" />
      ) : inFlight ? (
        <LoaderCircleIcon
          className="h-3 w-3 animate-spin"
          strokeWidth={1.5}
        />
      ) : null}
    </span>
  );
}

/** Messages with at least one renderable part (drops empty aborted turns). */
function visibleMessages(
  messages: VendorAssistantUIMessage[],
): VendorAssistantUIMessage[] {
  return messages.filter((message) =>
    message.parts.some(
      (part) =>
        (part.type === "text" && part.text.trim() !== "") ||
        (part.type === "reasoning" && part.text.trim() !== "") ||
        isToolUIPart(part),
    ),
  );
}

function errorCopy(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not a JSON error envelope — fall through to the generic copy.
  }
  return "The assistant hit a problem answering this. Please try again.";
}

type HistoryState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; messages: VendorAssistantUIMessage[] };

export function AssistantChat() {
  // Transcript hydration — one fetch per mount (portal idiom: plain fetch,
  // no react-query). The chat body mounts only once history has resolved,
  // because useChat seeds its messages exactly once.
  const [history, setHistory] = useState<HistoryState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setHistory({ phase: "loading" });
    void (async () => {
      try {
        const res = await fetch("/api/vendor/assistant", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`history failed with ${res.status}`);
        const body = (await res.json()) as AssistantHistoryResponse;
        if (!cancelled) {
          setHistory({ phase: "ready", messages: body.messages });
        }
      } catch {
        if (!cancelled) setHistory({ phase: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (history.phase === "loading") {
    // Skeleton bubbles mirroring the Message layout (user right-aligned,
    // assistant full-width) so hydration doesn't visibly re-layout.
    return (
      <div
        className="flex flex-1 flex-col gap-4 overflow-hidden p-4"
        role="status"
      >
        <span className="sr-only">Loading your conversation…</span>
        <div aria-hidden className="flex w-full justify-end">
          <Shimmer className="h-9 w-3/5 rounded-2xl" />
        </div>
        <div aria-hidden className="flex w-full flex-col gap-2">
          <Shimmer className="h-4 w-11/12 rounded-2xl" />
          <Shimmer className="h-4 w-4/5 rounded-2xl" />
          <Shimmer className="h-4 w-2/3 rounded-2xl" />
        </div>
        <div aria-hidden className="flex w-full justify-end">
          <Shimmer className="h-9 w-2/5 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (history.phase === "error") {
    return (
      <div className="flex flex-1 animate-fade-in flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <CircleAlertIcon className="h-5 w-5" />
        </span>
        <p className="text-sm text-muted-foreground">
          The conversation could not be loaded.
        </p>
        <Button
          onClick={() => setAttempt((n) => n + 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </div>
    );
  }

  return <AssistantChatBody initialMessages={history.messages} />;
}

function AssistantChatBody({
  initialMessages,
}: {
  initialMessages: VendorAssistantUIMessage[];
}) {
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport<VendorAssistantUIMessage>({
        api: "/api/vendor/assistant",
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: {
            id,
            message: messages[messages.length - 1],
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, stop, regenerate, clearError } =
    useChat<VendorAssistantUIMessage>({
      id: "vendor-assistant",
      messages: initialMessages,
      transport,
      experimental_throttle: 50,
    });

  const busy = status === "submitted" || status === "streaming";

  const submit = (text?: string) => {
    const value = (text ?? input).trim();
    if (value === "" || busy) return;
    clearError();
    void sendMessage({ text: value.slice(0, ASSISTANT_MAX_MESSAGE_CHARS) });
    if (text === undefined) setInput("");
  };

  const rendered = visibleMessages(messages);
  const last = messages.at(-1);
  // One thinking indicator below all messages — only while NOTHING else is
  // visibly rendering for the in-flight turn (a streaming reasoning block or
  // tool pill is already its own progress surface).
  const thinking =
    status === "submitted" ||
    (status === "streaming" &&
      (last?.role !== "assistant" ||
        !last.parts.some(
          (p) =>
            (p.type === "text" && p.text.trim() !== "") ||
            (p.type === "reasoning" && p.text.trim() !== "") ||
            isToolUIPart(p),
        )));

  return (
    <>
      <Conversation>
        <ConversationContent className="min-h-full">
          {rendered.length === 0 && !busy ? (
            <ConversationEmptyState className="flex-1 animate-fade-in-up">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-agent/10 text-agent">
                <MessageCircleQuestionIcon className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  Ask about your compliance record
                </h3>
                <p className="text-xs text-muted-foreground">
                  Questions about your documents, what&apos;s missing, or why
                  something failed — I can see your record as it processes.
                </p>
              </div>
              <div className="flex flex-col gap-1.5 pt-1">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]"
                    key={suggestion}
                    onClick={() => submit(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            <>
              {rendered.map((message, messageIdx) => {
                // The in-flight assistant turn gets a soft agent wash; the
                // -mx-2/px-2 + widened-width pair cancels out so the text
                // never shifts when the wash appears or drops.
                const liveAssistant =
                  status === "streaming" &&
                  message.role === "assistant" &&
                  messageIdx === rendered.length - 1;
                return (
                <Message
                  className={cn(
                    "animate-fade-in-up",
                    liveAssistant &&
                      "-mx-2 w-[calc(100%+1rem)] rounded-xl bg-gradient-to-r from-agent/5 to-transparent px-2",
                  )}
                  from={message.role}
                  key={message.id}
                >
                  <MessageContent>
                    {message.parts.map((part, idx) => {
                      const key = isToolUIPart(part)
                        ? part.toolCallId
                        : `${message.id}-${idx}`;
                      if (part.type === "text") {
                        return message.role === "user" ? (
                          <p className="whitespace-pre-wrap" key={key}>
                            {part.text}
                          </p>
                        ) : (
                          <Response key={key}>{part.text}</Response>
                        );
                      }
                      if (part.type === "reasoning") {
                        if (part.text.trim() === "") return null;
                        return (
                          <Reasoning
                            isStreaming={
                              status === "streaming" &&
                              messageIdx === rendered.length - 1 &&
                              idx === message.parts.length - 1
                            }
                            key={key}
                            reasoning={part.text}
                          >
                            <ReasoningTrigger />
                            <ReasoningContent />
                          </Reasoning>
                        );
                      }
                      if (isToolUIPart(part)) {
                        return (
                          <ToolPill
                            key={key}
                            live={busy && messageIdx === rendered.length - 1}
                            state={part.state}
                            toolName={getToolName(part)}
                          />
                        );
                      }
                      return null;
                    })}
                  </MessageContent>
                </Message>
                );
              })}
              {thinking && (
                <div
                  aria-live="polite"
                  className="flex animate-fade-in items-center gap-2 text-sm text-muted-foreground"
                  role="status"
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-agent"
                  />
                  <TextShimmer>Thinking…</TextShimmer>
                </div>
              )}
              {error && (
                <div
                  className="flex animate-fade-in flex-col gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  <span className="flex items-start gap-2">
                    <CircleAlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    {errorCopy(error)}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        clearError();
                        void regenerate();
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Retry
                    </Button>
                    <Button
                      onClick={clearError}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border/60 bg-background/80 p-3 backdrop-blur-md">
        <PromptInput onSubmit={() => submit()}>
          <PromptInputTextarea
            aria-label="Message the assistant"
            maxLength={ASSISTANT_MAX_MESSAGE_CHARS}
            onChange={(e) => setInput(e.currentTarget.value)}
            onEnterSubmit={() => submit()}
            placeholder="Ask about your compliance record…"
            value={input}
          />
          <PromptInputSubmit
            disabled={input.trim() === ""}
            onStop={() => void stop()}
            status={status}
          />
        </PromptInput>
      </div>
    </>
  );
}
