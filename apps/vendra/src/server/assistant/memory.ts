/**
 * Long-term memory for the vendor assistant — the memory-sandwich pattern
 * (recall before the turn, write during it) over this app's own Postgres.
 *
 * Deliberately NOT a vector store: the reliance set is exactly the Anthropic
 * API + Vercel Sandbox (CLAUDE.md rule 1) — there is no vector engine to
 * point at, and Anthropic ships no embeddings API to feed one. The service
 * keeps the boundary shape (recall / remember / caps / fail-soft) so a
 * vector engine could replace the storage without touching callers.
 */
import { randomUUID } from "node:crypto";

import { vendraError, vendraLog } from "@/server/harness/log";

import {
  insertMemoryFacts,
  listMemoryFacts,
  pruneMemoryFacts,
} from "./store";

/** Hard cap on stored facts per vendor (oldest pruned past this). */
const MAX_STORED_FACTS = 40;
/** Recall caps: at most N facts AND at most C characters (chars bind first). */
const RECALL_MAX_FACTS = 20;
const RECALL_MAX_CHARS = 2_000;

/**
 * Strip what must never persist: markup first (a stored fact re-enters the
 * prompt inside an XML fence, so angle brackets are an escape vector), then
 * SSN-shaped digits (before the phone matcher can eat them), then EINs
 * (dash form only — the bare 9-digit form is indistinguishable from ids),
 * then phone numbers, then emails.
 */
export function redactMemoryFact(fact: string): string {
  return fact
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, "[redacted-ssn]")
    .replace(/\b\d{2}-\d{7}\b/g, "[redacted-ein]")
    .replace(
      /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
      "[redacted-phone]",
    )
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[redacted-email]")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Recall remembered facts for prompt injection, capped by count and chars.
 * Fail-soft: a read failure returns [] — the chat must work without memory.
 */
export async function recallMemory(vendorUuid: string): Promise<string[]> {
  try {
    const stored = await listMemoryFacts(vendorUuid, MAX_STORED_FACTS);
    const recent = stored.slice(-RECALL_MAX_FACTS);
    const selected: string[] = [];
    let chars = 0;
    // Newest-first selection under the char budget, re-emitted oldest-first.
    for (const { fact } of [...recent].reverse()) {
      if (chars + fact.length > RECALL_MAX_CHARS) break;
      selected.push(fact);
      chars += fact.length;
    }
    return selected.reverse();
  } catch (err) {
    vendraError("assistant.memory_recall_failed", {
      vendor: vendorUuid,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Persist facts the agent chose to remember: redact → dedupe against the
 * stored set → append → prune past the cap. Returns the stored count.
 * Fail-soft with a visible log line (a silent memory-write death is the #1
 * operational trap — the log IS the alarm).
 */
export async function rememberFacts(
  vendorUuid: string,
  vendorId: number,
  facts: string[],
): Promise<number> {
  try {
    const existing = await listMemoryFacts(vendorUuid, MAX_STORED_FACTS);
    const known = new Set(existing.map((f) => f.fact.toLowerCase().trim()));
    const fresh = facts
      .map((fact) => redactMemoryFact(fact.trim()))
      .filter((fact) => fact.length > 0 && !known.has(fact.toLowerCase()));
    if (fresh.length === 0) return 0;
    await insertMemoryFacts(
      vendorUuid,
      vendorId,
      fresh.map((fact) => ({ messageId: randomUUID(), fact })),
    );
    await pruneMemoryFacts(vendorUuid, MAX_STORED_FACTS);
    vendraLog("assistant.memory_write", { vendor: vendorUuid, facts: fresh.length });
    return fresh.length;
  } catch (err) {
    vendraError("assistant.memory_write_failed", {
      vendor: vendorUuid,
      err: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
