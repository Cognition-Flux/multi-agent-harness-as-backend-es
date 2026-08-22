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

import { MEMORY_AGENT_ID } from "./config";
import {
  clearMem0Ids,
  linkMem0Id,
  listAllLiveMemories,
  listUnindexedMemories,
} from "./db";
import { getMemoryClient } from "./mem0-client";

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
