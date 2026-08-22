/**
 * Semantic recall (SPEC §22) — the read side of the memory layer.
 *
 * This is the change that justifies the whole layer. Before mem0, recall was
 * chronological: the newest N facts under a char budget, so a vendor asking
 * about insurance got whatever they last mentioned, about anything. Now the
 * query drives retrieval and the budget only trims the tail.
 *
 * **Fail-soft is the contract, not a nicety.** Every failure path — layer
 * unconfigured, Qdrant down, Ollama down, embedding timeout, zero hits —
 * returns the Postgres recency list instead, which is exactly the pre-mem0
 * behaviour. A vendor must never see a chat degrade because an index is
 * unreachable, and the log line is the alarm.
 */
import { vendraError, vendraLog, vendraWarn } from "@/server/harness/log";

import {
  MEMORY_AGENT_ID,
  RECALL_MAX_CHARS,
  RECALL_MAX_FACTS,
  RECALL_SEARCH_LIMIT,
} from "./config";
import { listLiveMemories } from "./db";
import { redactMemoryFact } from "./redact";
import { getMemoryClient } from "./mem0-client";

export type RecallMode = "semantic" | "recency" | "empty";

export interface RecallResult {
  facts: string[];
  mode: RecallMode;
}

/**
 * Trim to the prompt budget: at most N facts AND at most C characters, chars
 * binding first. Order is preserved — for a semantic recall that means
 * most-relevant first, which is also the order we want inside the prompt.
 */
function applyBudget(facts: string[]): string[] {
  const selected: string[] = [];
  let chars = 0;
  for (const fact of facts.slice(0, RECALL_MAX_FACTS)) {
    if (chars + fact.length > RECALL_MAX_CHARS) break;
    selected.push(fact);
    chars += fact.length;
  }
  return selected;
}

/** The pre-mem0 path: newest-first, re-emitted oldest-first for the prompt. */
async function recencyRecall(vendorUuid: string): Promise<RecallResult> {
  try {
    const rows = await listLiveMemories(vendorUuid, RECALL_MAX_FACTS);
    const facts = applyBudget(rows.map((row) => row.fact)).reverse();
    return { facts, mode: facts.length > 0 ? "recency" : "empty" };
  } catch (err) {
    vendraError("memory.recall_fallback_failed", {
      vendor: vendorUuid,
      err: err instanceof Error ? err.message : String(err),
    });
    return { facts: [], mode: "empty" };
  }
}

/**
 * Recall facts relevant to `query`, falling back to recency on any failure.
 *
 * `query` is the vendor's own turn text. An empty query has nothing to be
 * relevant to, so it takes the recency path directly rather than asking the
 * index to rank against nothing.
 */
export async function recallRelevant(
  vendorUuid: string,
  query: string,
): Promise<RecallResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return recencyRecall(vendorUuid);

  let client;
  try {
    client = await getMemoryClient();
  } catch (err) {
    vendraError("memory.client_unavailable", {
      err: err instanceof Error ? err.message : String(err),
    });
    client = null;
  }
  if (!client) return recencyRecall(vendorUuid);

  try {
    const result = await client.search(trimmed, {
      topK: RECALL_SEARCH_LIMIT,
      // Scoping is snake_case on search (camelCase on add) — see mem0-client.ts.
      filters: { user_id: vendorUuid, agent_id: MEMORY_AGENT_ID },
    });
    // Redact on the way out as well as the way in. Semantic recall reads the
    // INDEX's text (Qdrant payload), not the vetted assistant_memory row — so
    // this is the last gate before a fact re-enters a prompt, and it also
    // cleans entries indexed before redaction-at-enqueue existed.
    const facts = applyBudget(
      (result.results ?? [])
        .map((item) => (item.memory ? redactMemoryFact(item.memory) : ""))
        .filter((fact): fact is string => fact.length > 0),
    );
    if (facts.length === 0) {
      // An empty index is normal for a new vendor; an empty index with rows in
      // Postgres means the drain has not caught up or the index was lost.
      return recencyRecall(vendorUuid);
    }
    vendraLog("memory.recall", {
      vendor: vendorUuid,
      mode: "semantic",
      facts: facts.length,
    });
    return { facts, mode: "semantic" };
  } catch (err) {
    vendraWarn("memory.recall_degraded", {
      vendor: vendorUuid,
      err: err instanceof Error ? err.message : String(err),
    });
    return recencyRecall(vendorUuid);
  }
}
