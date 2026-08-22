/**
 * Long-term memory for the vendor assistant — the memory-sandwich pattern
 * (recall before the turn, write during it).
 *
 * This module is now a FAÇADE over the memory layer in `server/memory/`
 * (SPEC §22). Its own header used to explain why memory was deliberately not a
 * vector store — "there is no vector engine to point at, and Anthropic ships no
 * embeddings API to feed one" — and that is what changed: the engine (Qdrant)
 * and the embedder (Ollama + bge-m3) now run in this repo's own containers, so
 * recall can finally be about relevance instead of recency.
 *
 * The signatures did not change, on purpose: `tools.ts`, `session.ts` and the
 * `<long_term_memory>` block in `prompt.ts` are untouched by the swap. What
 * changed underneath:
 *
 *  - recall asks the index for facts related to the vendor's actual question,
 *    and falls back to the old recency list whenever the index is unreachable;
 *  - writes land in `assistant_memory` (a real table, not a piggyback thread on
 *    `assistant_chat_turn`) and are indexed by a background drain;
 *  - the conversation itself is queued for extraction, so the agent no longer
 *    has to notice what is worth remembering.
 *
 * `redactMemoryFact` moved to `server/memory/redact.ts` (re-exported below for
 * continuity) because it now has two producers: facts the agent chose, and
 * facts mem0 extracted. The second matters more — nobody vetted those before
 * the regex did.
 */
import { vendraLog } from "@/server/harness/log";
import { recordFacts, recordTurn } from "@/server/memory/ingest";
import { recallRelevant } from "@/server/memory/recall";
import { redactMemoryFact } from "@/server/memory/redact";

// Re-exported for continuity: the redaction gate moved into the memory layer
// (two producers now feed it — see server/memory/redact.ts).
export { redactMemoryFact };

/**
 * Recall remembered facts for prompt injection.
 *
 * `query` is the vendor's turn text; pass it whenever it is available, because
 * it is what makes recall semantic. Omitting it is valid and degrades to the
 * recency list — the caller keeps working either way. `orgScope`
 * (`org:<orgUuid>`, see `orgScopeKey`) merges the company's directive
 * memories into the same budget (SPEC §24.6).
 */
export async function recallMemory(
  vendorUuid: string,
  query = "",
  orgScope?: string,
): Promise<string[]> {
  const { facts } = await recallRelevant(vendorUuid, query, orgScope);
  return facts;
}

/**
 * Persist facts the agent chose to remember: redact → record → queue for
 * indexing. Returns the stored count.
 *
 * Fail-soft with a visible log line (a silent memory-write death is the #1
 * operational trap — the log IS the alarm).
 */
export async function rememberFacts(
  vendorUuid: string,
  vendorId: number,
  facts: string[],
  threadId = vendorUuid,
): Promise<number> {
  const clean = facts
    .map((fact) => redactMemoryFact(fact.trim()))
    .filter((fact) => fact.length > 0);
  if (clean.length === 0) return 0;
  const stored = await recordFacts(
    { vendorId, vendorUuid, threadId },
    clean,
  );
  if (stored > 0) {
    vendraLog("assistant.memory_write", { vendor: vendorUuid, facts: stored });
  }
  return stored;
}

/**
 * Queue a vendor turn for background fact extraction.
 *
 * Separate from `rememberFacts` because it is a different contract: nothing is
 * stored yet, and mem0 decides whether anything durable was said at all.
 */
export async function observeVendorTurn(
  vendorUuid: string,
  vendorId: number,
  threadId: string,
  vendorText: string,
): Promise<void> {
  await recordTurn({ vendorId, vendorUuid, threadId }, vendorText);
}
