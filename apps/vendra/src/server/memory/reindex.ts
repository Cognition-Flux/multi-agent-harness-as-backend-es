/**
 * Rebuild the semantic index from Postgres (SPEC §22).
 *
 * This is what makes the Qdrant volume disposable, and it is the reason the
 * two-store split is worth its complexity: `assistant_memory` is the truth, so
 * losing the index costs a rebuild, never a memory.
 *
 * Two modes:
 *  - `backfill` — index rows that have no mem0 id yet. Safe to run any time;
 *    this is also how the pre-mem0 facts got in.
 *  - `rebuild` — the index is gone or suspect: forget every id and re-index
 *    everything live.
 *
 * Inference is OFF throughout. These facts were already extracted and
 * consolidated once; running the LLM over them again would paraphrase them into
 * near-duplicates and bill for the privilege.
 */
import { vendraError, vendraLog } from "@/server/harness/log";

import { getDb, schema } from "@vendra/db-vendor";

import { MEMORY_AGENT_ID } from "./config";
import {
  clearMem0Ids,
  linkMem0Id,
  listAllLiveMemories,
  listAllMem0Ids,
  listUnindexedMemories,
  recordExtractedFact,
} from "./db";
import { getMemoryClient } from "./mem0-client";
import { redactMemoryFact } from "./redact";

export interface ReindexResult {
  mode: "backfill" | "rebuild";
  candidates: number;
  indexed: number;
  failed: number;
}

export async function reindexMemories(
  mode: "backfill" | "rebuild" = "backfill",
  limit = 5_000,
): Promise<ReindexResult> {
  const client = await getMemoryClient();
  if (!client) {
    vendraError("memory.reindex_unavailable", { mode });
    return { mode, candidates: 0, indexed: 0, failed: 0 };
  }

  if (mode === "rebuild") {
    // Reset the INDEX first. A rebuild against a surviving collection would
    // add every fact a second time (mem0 point ids are fresh uuids, so nothing
    // collides — it just duplicates), and the stale points would keep matching
    // searches forever. reset() drops the collection; the next add recreates
    // it with the configured dimension. History is disabled, so the "history
    // database" half of reset is a no-op here.
    await client.reset();
    const cleared = await clearMem0Ids();
    vendraLog("memory.reindex_cleared", { rows: cleared });
  }

  const rows =
    mode === "rebuild"
      ? await listAllLiveMemories()
      : await listUnindexedMemories(limit);

  let indexed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await client.add(row.fact, {
        userId: row.vendorUuid,
        agentId: MEMORY_AGENT_ID,
        infer: false,
        metadata: { source: "reindex" },
      });
      const first = (result.results ?? [])[0] as { id?: string } | undefined;
      if (first?.id) {
        await linkMem0Id(row.id, first.id);
        indexed += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      vendraError("memory.reindex_row_failed", {
        row: row.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  vendraLog("memory.reindex_done", {
    mode,
    candidates: rows.length,
    indexed,
    failed,
  });
  return { mode, candidates: rows.length, indexed, failed };
}

/**
 * Adopt index orphans back into the system of record (SPEC §22).
 *
 * The one loss window the drain cannot close itself: mem0's `add()` commits
 * the extracted fact into Qdrant BEFORE the drain reconciles it into
 * `assistant_memory`, and on a crash in between the retry's `add()` dedupes
 * against the index and returns zero decisions — so the fact exists only in
 * the index, invisible to fallback recall and erased by the next rebuild.
 * This pass walks every vendor, diffs mem0's memories against ALL ids the
 * record has ever linked, and adopts what is missing (redacted, as always).
 */
export async function adoptIndexOrphans(): Promise<{
  vendors: number;
  orphansAdopted: number;
}> {
  const client = await getMemoryClient();
  if (!client) {
    vendraError("memory.adopt_unavailable", {});
    return { vendors: 0, orphansAdopted: 0 };
  }
  const vendors = await getDb()
    .select({ id: schema.vendor.id, uuid: schema.vendor.uuid })
    .from(schema.vendor);
  let orphansAdopted = 0;
  for (const v of vendors) {
    try {
      const [known, indexed] = await Promise.all([
        listAllMem0Ids(v.uuid),
        client.getAll({
          topK: 1_000,
          filters: { user_id: v.uuid, agent_id: MEMORY_AGENT_ID },
        }),
      ]);
      for (const item of indexed.results ?? []) {
        if (!item.id || known.has(item.id)) continue;
        const fact = item.memory ? redactMemoryFact(item.memory) : "";
        if (!fact) continue;
        await recordExtractedFact({
          vendorId: v.id,
          vendorUuid: v.uuid,
          fact,
          mem0MemoryId: item.id,
        });
        orphansAdopted += 1;
      }
    } catch (err) {
      vendraError("memory.adopt_vendor_failed", {
        vendor: v.uuid,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  vendraLog("memory.adopt_done", { vendors: vendors.length, orphansAdopted });
  return { vendors: vendors.length, orphansAdopted };
}
