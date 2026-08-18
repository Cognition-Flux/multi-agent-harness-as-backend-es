/**
 * Vendor-assistant persistence over this app's own `assistant_chat_turn`
 * table (a generic {thread_id, message_id, role, parts, metadata} turn
 * store — packages/db-vendor). Three thread namespaces per vendor, all
 * keyed by the vendor uuid:
 *   vendor-chat:<uuid>     — the UIMessage transcript (one row per message)
 *   vendor-session:<uuid>  — ONE row holding the harness session resume-state
 *   vendor-memory:<uuid>   — remembered facts (one row per fact)
 * Every write lands on the (thread_id, message_id) unique constraint:
 * transcript inserts are targetless onConflictDoNothing (idempotent
 * retries), the resume-state row is an upsert at a fixed message_id.
 */
import { asc, desc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";

import type { VendorAssistantUIMessage } from "@/features/vendor-compliance/lib/vendor-harness-contract";

const { assistantChatTurn } = schema;

const chatThreadId = (vendorUuid: string) => `vendor-chat:${vendorUuid}`;
const sessionThreadId = (vendorUuid: string) => `vendor-session:${vendorUuid}`;
const memoryThreadId = (vendorUuid: string) => `vendor-memory:${vendorUuid}`;

const RESUME_STATE_MESSAGE_ID = "harness-resume-state";

// ── Transcript ───────────────────────────────────────────────────────────────

/**
 * Tail-windowed transcript read (newest `limit` rows, returned oldest-first)
 * for panel hydration.
 */
export async function listAssistantMessages(
  vendorUuid: string,
  limit: number,
): Promise<VendorAssistantUIMessage[]> {
  const rows = await getDb()
    .select({
      messageId: assistantChatTurn.messageId,
      role: assistantChatTurn.role,
      parts: assistantChatTurn.parts,
      metadata: assistantChatTurn.metadata,
    })
    .from(assistantChatTurn)
    .where(eq(assistantChatTurn.threadId, chatThreadId(vendorUuid)))
    .orderBy(desc(assistantChatTurn.createdAt), desc(assistantChatTurn.id))
    .limit(limit);
  rows.reverse();
  return rows.map((row) => ({
    id: row.messageId,
    role: row.role as VendorAssistantUIMessage["role"],
    parts: row.parts as VendorAssistantUIMessage["parts"],
    ...(row.metadata ? { metadata: row.metadata } : {}),
  }));
}

/**
 * Persist a batch of UIMessages for one vendor thread. Idempotent: rows land
 * on the (thread_id, message_id) unique constraint with a targetless
 * onConflictDoNothing, so the optimistic pre-persist and the onEnd re-send
 * can never duplicate a turn.
 */
export async function insertAssistantMessages(
  vendorUuid: string,
  vendorId: number,
  messages: VendorAssistantUIMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  await getDb()
    .insert(assistantChatTurn)
    .values(
      messages.map((message) => ({
        threadId: chatThreadId(vendorUuid),
        vendorId,
        messageId: message.id,
        role: message.role,
        parts: message.parts,
        metadata: message.metadata ?? null,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Delete the oldest transcript rows beyond `keep` — the chat only ever
 * reloads the ASSISTANT_HISTORY_LIMIT tail, so an unbounded thread is pure
 * table growth. Called fail-open from the route's onEnd.
 */
export async function pruneAssistantMessages(
  vendorUuid: string,
  keep: number,
): Promise<void> {
  await getDb().execute(sql`
    DELETE FROM assistant_chat_turn
    WHERE thread_id = ${chatThreadId(vendorUuid)}
      AND id NOT IN (
        SELECT id FROM assistant_chat_turn
        WHERE thread_id = ${chatThreadId(vendorUuid)}
        ORDER BY created_at DESC, id DESC
        LIMIT ${keep}
      )
  `);
}

// ── Harness session resume-state ─────────────────────────────────────────────

export interface StoredAssistantSession {
  sessionId: string;
  /** Opaque HarnessAgentResumeSessionState from session.stop(). */
  resumeState: unknown;
  updatedAt: string;
}

/** Load the parked harness session state, if any. */
export async function loadAssistantSessionState(
  vendorUuid: string,
): Promise<StoredAssistantSession | null> {
  const [row] = await getDb()
    .select({ metadata: assistantChatTurn.metadata })
    .from(assistantChatTurn)
    .where(eq(assistantChatTurn.threadId, sessionThreadId(vendorUuid)))
    .limit(1);
  const meta = row?.metadata as StoredAssistantSession | null | undefined;
  if (!meta || typeof meta.sessionId !== "string" || !meta.resumeState) {
    return null;
  }
  return meta;
}

/** Upsert the parked harness session state (fixed message_id → one row). */
export async function saveAssistantSessionState(
  vendorUuid: string,
  vendorId: number,
  state: StoredAssistantSession,
): Promise<void> {
  await getDb()
    .insert(assistantChatTurn)
    .values({
      threadId: sessionThreadId(vendorUuid),
      vendorId,
      messageId: RESUME_STATE_MESSAGE_ID,
      role: "system",
      parts: [],
      metadata: state,
    })
    .onConflictDoUpdate({
      target: [assistantChatTurn.threadId, assistantChatTurn.messageId],
      set: {
        metadata: state,
        createdAt: sql`CURRENT_TIMESTAMP`,
      },
    });
}

/** Drop the parked state (resume failed / session destroyed). */
export async function clearAssistantSessionState(
  vendorUuid: string,
): Promise<void> {
  await getDb()
    .delete(assistantChatTurn)
    .where(eq(assistantChatTurn.threadId, sessionThreadId(vendorUuid)));
}

// ── Memory facts ─────────────────────────────────────────────────────────────

export interface StoredMemoryFact {
  messageId: string;
  fact: string;
  createdAt: Date;
}

/** Oldest-first list of remembered facts (bounded by the caller's cap). */
export async function listMemoryFacts(
  vendorUuid: string,
  limit: number,
): Promise<StoredMemoryFact[]> {
  const rows = await getDb()
    .select({
      messageId: assistantChatTurn.messageId,
      parts: assistantChatTurn.parts,
      createdAt: assistantChatTurn.createdAt,
    })
    .from(assistantChatTurn)
    .where(eq(assistantChatTurn.threadId, memoryThreadId(vendorUuid)))
    .orderBy(asc(assistantChatTurn.createdAt), asc(assistantChatTurn.id))
    .limit(limit);
  return rows.flatMap((row) => {
    const part = (row.parts as { type?: string; text?: string }[])[0];
    return typeof part?.text === "string"
      ? [
          {
            messageId: row.messageId,
            fact: part.text,
            createdAt: row.createdAt,
          },
        ]
      : [];
  });
}

/** Append memory facts (one row each; ids minted by the caller). */
export async function insertMemoryFacts(
  vendorUuid: string,
  vendorId: number,
  facts: { messageId: string; fact: string }[],
): Promise<void> {
  if (facts.length === 0) return;
  await getDb()
    .insert(assistantChatTurn)
    .values(
      facts.map(({ messageId, fact }) => ({
        threadId: memoryThreadId(vendorUuid),
        vendorId,
        messageId,
        role: "memory",
        parts: [{ type: "text", text: fact }],
        metadata: null,
      })),
    )
    .onConflictDoNothing();
}

/** Delete the oldest facts beyond `keep` (bounds the memory thread). */
export async function pruneMemoryFacts(
  vendorUuid: string,
  keep: number,
): Promise<void> {
  await getDb().execute(sql`
    DELETE FROM assistant_chat_turn
    WHERE thread_id = ${memoryThreadId(vendorUuid)}
      AND id NOT IN (
        SELECT id FROM assistant_chat_turn
        WHERE thread_id = ${memoryThreadId(vendorUuid)}
        ORDER BY created_at DESC, id DESC
        LIMIT ${keep}
      )
  `);
}
