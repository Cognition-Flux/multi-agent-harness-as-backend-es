/**
 * The write side's front door (SPEC §22): record now, index later.
 *
 * Two entry points, both cheap and both fail-soft:
 *
 *  - `recordFacts` — the agent's `rememberFacts` tool. The fact is written to
 *    `assistant_memory` (the system of record) synchronously, because losing a
 *    fact the vendor explicitly stated is the one outcome worth a round-trip,
 *    and queued for indexing.
 *  - `recordTurn` — the conversation itself, queued for mem0 to extract facts
 *    from. This is the "managed in the background" half: nobody has to decide
 *    what is worth remembering.
 *
 * Neither touches the index. A stopped Qdrant or Ollama changes nothing here —
 * the queue just grows and the drain catches up.
 */
import { vendraError, vendraLog } from "@/server/harness/log";

import { enqueueMemoryWork, insertMemories } from "./db";

/** Below this, a turn is a greeting or an acknowledgement — nothing to learn. */
const MIN_TURN_CHARS = 24;

export interface MemoryWriteTarget {
  vendorId: number;
  vendorUuid: string;
  threadId: string;
}

/**
 * Store facts the agent chose to remember, already redacted by the caller.
 * Returns how many became new records (duplicates are silently absorbed).
 */
export async function recordFacts(
  target: MemoryWriteTarget,
  facts: string[],
): Promise<number> {
  if (facts.length === 0) return 0;
  try {
    const inserted = await insertMemories({
      vendorId: target.vendorId,
      vendorUuid: target.vendorUuid,
      facts,
      source: "tool",
    });
    if (inserted.length === 0) return 0;
    await enqueueMemoryWork({
      vendorId: target.vendorId,
      vendorUuid: target.vendorUuid,
      threadId: target.threadId,
      kind: "fact",
      payload: { rows: inserted },
    });
    vendraLog("memory.facts_recorded", {
      vendor: target.vendorUuid,
      facts: inserted.length,
    });
    return inserted.length;
  } catch (err) {
    vendraError("memory.record_failed", {
      vendor: target.vendorUuid,
      err: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * Queue a completed turn for background extraction.
 *
 * Only the VENDOR's words are enqueued. Feeding the assistant's own output back
 * in would have it remember its own explanations as if the vendor had said
 * them — the fastest way to poison a memory store — and it doubles the
 * extraction bill for text we generated.
 */
export async function recordTurn(
  target: MemoryWriteTarget,
  vendorText: string,
): Promise<void> {
  const text = vendorText.trim();
  if (text.length < MIN_TURN_CHARS) return;
  try {
    await enqueueMemoryWork({
      vendorId: target.vendorId,
      vendorUuid: target.vendorUuid,
      threadId: target.threadId,
      kind: "turn",
      payload: { text },
    });
  } catch (err) {
    vendraError("memory.enqueue_failed", {
      vendor: target.vendorUuid,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
