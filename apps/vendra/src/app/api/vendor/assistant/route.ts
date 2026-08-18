/**
 * The vendor assistant chat — GET hydrates the transcript, POST streams one
 * turn (SPEC §7 companion surface).
 *
 * One Claude Code harness session per vendor thread (resumed between turns
 * via persisted stop-state — see server/assistant/session.ts), streamed as
 * a UI message stream (never createAgentUIStreamResponse — it does not
 * thread the harness session). Host tools give the agent live, page-equal
 * compliance state; the memory sandwich recalls remembered facts before the
 * turn and the agent writes new ones through the rememberFacts tool.
 *
 * Identity is cookie-implied: the better-auth session names the vendor —
 * the body never does. Disconnect semantics — the OPPOSITE of the document
 * route: the abort composes req.signal WITH the timeout, because a chat
 * turn only matters to the person watching it. The user turn is
 * optimistically pre-persisted (idempotent on the (thread_id, message_id)
 * unique constraint), so an abandoned turn never loses the question.
 */
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
} from "ai";

import type {
  AssistantHistoryResponse,
  VendorAssistantUIMessage,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";
import {
  ASSISTANT_HISTORY_LIMIT,
  assistantChatRequestSchema,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { recallMemory } from "@/server/assistant/memory";
import {
  buildAssistantInstructions,
  buildAssistantTurnPrompt,
} from "@/server/assistant/prompt";
import { checkRateLimit, refundRateLimit } from "@/server/assistant/rate-limit";
import {
  ASSISTANT_THREAD_BUSY,
  leaseAssistantTurn,
} from "@/server/assistant/session";
import {
  insertAssistantMessages,
  listAssistantMessages,
  pruneAssistantMessages,
} from "@/server/assistant/store";
import { buildAssistantTools } from "@/server/assistant/tools";
import { authFailureResponse, requireVendorContact } from "@/server/auth-guards";
import { vendraError, vendraLog, vendraWarn } from "@/server/harness/log";
import { missingHarnessCredentialNames } from "@/server/harness/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Worst case: a cold sandbox+bridge bootstrap (~3 min) ahead of the turn.
export const maxDuration = 300;
const TURN_TIMEOUT_MS = 270_000;

/** 20 turns per vendor per 5 minutes. */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export async function GET() {
  const auth = await requireVendorContact();
  if (!auth.ok) return authFailureResponse(auth.failure);
  const messages = await listAssistantMessages(
    auth.ctx.vendor.uuid,
    ASSISTANT_HISTORY_LIMIT,
  );
  const body: AssistantHistoryResponse = { messages };
  return Response.json(body);
}

export async function POST(req: Request) {
  const auth = await requireVendorContact();
  if (!auth.ok) return authFailureResponse(auth.failure);
  const { vendor, organization } = auth.ctx;
  const vendorUuid = vendor.uuid;

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return errorResponse("Malformed JSON body.", 400);
  }
  const parsed = assistantChatRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".");
    return errorResponse(
      `${path ? `${path}: ` : ""}${issue?.message ?? "Invalid request body."}`,
      400,
    );
  }
  const { message } = parsed.data;

  // Same pre-stream degradation as the document process route: without the
  // four harness keys the app must answer with clean copy, not a throw.
  if (missingHarnessCredentialNames().length > 0) {
    return errorResponse(
      "The assistant is unavailable right now. Please try again.",
      503,
    );
  }

  const { allowed } = checkRateLimit(
    `chat:${vendorUuid}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!allowed) {
    vendraWarn("assistant.rate_limited", { vendor: vendorUuid });
    return errorResponse(
      "Too many messages — please wait a moment and try again.",
      429,
    );
  }

  const abortSignal = AbortSignal.any([
    req.signal,
    AbortSignal.timeout(TURN_TIMEOUT_MS),
  ]);

  const vendorName = vendor.legalName?.trim() || "the vendor";

  let lease;
  try {
    lease = await leaseAssistantTurn({
      vendorUuid,
      vendorId: vendor.id,
      instructions: buildAssistantInstructions({
        vendorName,
        orgName: organization.name,
      }),
      tools: buildAssistantTools({ vendorUuid, vendorId: vendor.id }),
      abortSignal,
    });
  } catch (err) {
    // Rejected before any work — hand the quota slot back (self-lockout
    // guard: retries against a long-streaming turn must not eat the window).
    refundRateLimit(`chat:${vendorUuid}`, RATE_LIMIT_WINDOW_MS);
    // Capacity contention is not an outage (spec §16 B5): a leased-out
    // bridge-port pool, or the turn timeout firing while queued behind the
    // doc lane's semaphore, both mean "busy", not "down".
    const leaseError = err instanceof Error ? err.message : String(err);
    const capacityContention =
      leaseError.includes("No available bridge port") ||
      (abortSignal.aborted && !req.signal.aborted);
    vendraError("assistant.lease_failed", {
      vendor: vendorUuid,
      capacity: capacityContention,
      err: leaseError,
    });
    return errorResponse(
      capacityContention
        ? "The assistant is busy while your documents are processing — try again in a moment."
        : "The assistant is unavailable right now. Please try again.",
      503,
    );
  }
  if (lease === ASSISTANT_THREAD_BUSY) {
    refundRateLimit(`chat:${vendorUuid}`, RATE_LIMIT_WINDOW_MS);
    vendraWarn("assistant.thread_busy", { vendor: vendorUuid });
    return errorResponse(
      "The assistant is still answering — wait for the current reply.",
      409,
    );
  }
  const turn = lease;
  const turnStartedAt = Date.now();
  vendraLog("assistant.turn_start", {
    vendor: vendorUuid,
    fresh: turn.isFreshSession,
  });

  const userMessage: VendorAssistantUIMessage = {
    id: message.id,
    role: "user",
    parts: message.parts,
  };
  // Optimistic pre-persist (fail-open): an aborted/failed turn must not lose
  // the question the client already rendered. Idempotent with onEnd's
  // re-send via the (thread_id, message_id) unique constraint.
  await insertAssistantMessages(vendorUuid, vendor.id, [userMessage]).catch(
    (err) =>
      vendraError("assistant.user_persist_failed", {
        vendor: vendorUuid,
        err: err instanceof Error ? err.message : String(err),
      }),
  );

  const userText = message.parts.map((part) => part.text).join("\n\n");
  // Memory recall — injected only when the session starts fresh (a resumed
  // session already carries the block in its own history).
  const memoryFacts = turn.isFreshSession
    ? await recallMemory(vendorUuid)
    : [];

  let fatal = false;
  const stream = createUIMessageStream<VendorAssistantUIMessage>({
    originalMessages: [userMessage],
    execute: async ({ writer }) => {
      try {
        const result = await turn.agent.stream({
          session: turn.session,
          prompt: buildAssistantTurnPrompt({
            userText,
            nowIso: new Date().toISOString(),
            ...(memoryFacts.length > 0 ? { memoryFacts } : {}),
          }),
          abortSignal,
        });
        writer.merge(
          toUIMessageStream({ stream: result.stream, sendReasoning: true }),
        );
        await result.text;
      } catch (err) {
        fatal = true;
        throw err;
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      vendraError("assistant.stream_error", { vendor: vendorUuid, err: msg });
      return "The assistant hit a problem answering this. Please try again.";
    },
    onEnd: async ({ messages }) => {
      // event.isAborted only reflects an "abort" stream part, which harness
      // streams never emit — the signal is the real abort authority here.
      const aborted = abortSignal.aborted;
      try {
        let persistable = messages.filter((m) => m.parts.length > 0);
        if (aborted) {
          // Spec §16 B4: a Stop/timeout keeps the partial reply, marked. The
          // slot is NOT refunded — an unconditional abort refund would let a
          // scripted stop-loop bypass the rate limit entirely while still
          // consuming harness capacity (refunds stay reserved for turns
          // rejected before any work: the lease throw and the 409).
          persistable = persistable.map((m) =>
            m.role === "assistant"
              ? {
                  ...m,
                  parts: [
                    ...m.parts,
                    { type: "text" as const, text: "\n\n— *interrupted*" },
                  ],
                }
              : m,
          );
        }
        await insertAssistantMessages(vendorUuid, vendor.id, persistable).catch(
          (err) =>
            vendraError("assistant.turn_persist_failed", {
              vendor: vendorUuid,
              err: err instanceof Error ? err.message : String(err),
            }),
        );
        // Bound the transcript thread (the client only ever reloads the
        // ASSISTANT_HISTORY_LIMIT tail). Fail-open like the persists.
        await pruneAssistantMessages(
          vendorUuid,
          5 * ASSISTANT_HISTORY_LIMIT,
        ).catch((err) =>
          vendraError("assistant.prune_failed", {
            vendor: vendorUuid,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        // An aborted turn may still be live inside the runtime — parking it
        // would strand a suspended turn the next stream() cannot enter, so
        // abort (like a fatal error) destroys; the next message starts a
        // fresh session. The persisted partial above kept the exchange.
        await turn.finish({ keepResumable: !fatal && !aborted });
        vendraLog("assistant.turn_done", {
          vendor: vendorUuid,
          aborted,
          fatal,
          ms: Date.now() - turnStartedAt,
        });
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
