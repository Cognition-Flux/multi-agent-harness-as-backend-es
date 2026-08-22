/**
 * Memory index maintenance (SPEC §22) — the tool that makes the Qdrant volume
 * disposable.
 *
 * Three jobs, all idempotent:
 *
 *   --adopt-legacy   Copy pre-§22 facts (rows in `assistant_chat_turn` with
 *                    role='memory') into `assistant_memory`. Run once after
 *                    deploying §22; safe to re-run.
 *   --backfill       Index every `assistant_memory` row that has no mem0 id
 *                    yet. This is the normal catch-up.
 *   --rebuild        RESET the Qdrant collection, forget every mem0 id, and
 *                    re-index everything live. For a lost, duplicated or
 *                    suspect index.
 *   --adopt-index    Reverse direction: adopt facts that exist only in the
 *                    index (a crash between mem0's write and ours) back into
 *                    `assistant_memory`. Run before --rebuild when the index
 *                    might hold facts the record lost.
 *
 * Usage (cwd must be apps/vendra so tsx resolves the `@/` alias; the pnpm
 * script handles that and loads .env.local):
 *
 *   pnpm --filter vendra memory-reindex -- --adopt-legacy --backfill
 *   pnpm --filter vendra memory-reindex -- --rebuild
 *
 * Prints one JSON line per job. Inference is OFF throughout: these facts were
 * already extracted and consolidated once, and re-running the LLM over them
 * would paraphrase them into near-duplicates and bill for it.
 */
import { parseArgs } from "node:util";

import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb, getPool, schema } from "@vendra/db-vendor";

import { memoryConfigGap } from "../src/server/memory/config";
import { adoptIndexOrphans, reindexMemories } from "../src/server/memory/reindex";
import { redactMemoryFact } from "../src/server/memory/redact";

const { assistantChatTurn, assistantMemory, vendor } = schema;

function fail(message: string): never {
  console.error(`[vendra:memory-reindex] ${message}`);
  process.exit(1);
}

/**
 * Adopt the legacy piggyback rows.
 *
 * Pre-§22, facts were rows in `assistant_chat_turn` with `role='memory'` on a
 * synthetic `vendor-memory:<uuid>` thread. They are left in place on purpose:
 * nothing reads them any more, and keeping them makes the cutover reversible.
 */
async function adoptLegacy(): Promise<{ found: number; adopted: number }> {
  const db = getDb();
  const rows = await db
    .select({
      threadId: assistantChatTurn.threadId,
      vendorId: assistantChatTurn.vendorId,
      parts: assistantChatTurn.parts,
    })
    .from(assistantChatTurn)
    .where(eq(assistantChatTurn.role, "memory"));

  let adopted = 0;
  for (const row of rows) {
    const part = (row.parts as { type?: string; text?: string }[])[0];
    const raw = typeof part?.text === "string" ? part.text : "";
    const fact = redactMemoryFact(raw);
    if (!fact) continue;
    // The thread id is `vendor-memory:<vendorUuid>`; the uuid is the scope key.
    const vendorUuid = row.threadId.split(":").slice(1).join(":");
    if (!vendorUuid) continue;
    // Confirm the vendor still exists and the uuid matches the id, so a stale
    // thread cannot inject a fact under the wrong tenant.
    const [owner] = await db
      .select({ id: vendor.id })
      .from(vendor)
      .where(and(eq(vendor.id, row.vendorId), eq(vendor.uuid, vendorUuid)))
      .limit(1);
    if (!owner) continue;
    const inserted = await db
      .insert(assistantMemory)
      .values({
        vendorId: row.vendorId,
        vendorUuid,
        fact,
        source: "tool",
      })
      .onConflictDoNothing()
      .returning({ id: assistantMemory.id });
    adopted += inserted.length;
  }
  return { found: rows.length, adopted };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const dashIdx = rawArgs.indexOf("--");
  const args =
    dashIdx === -1
      ? rawArgs
      : [...rawArgs.slice(0, dashIdx), ...rawArgs.slice(dashIdx + 1)];
  const { values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "adopt-legacy": { type: "boolean" },
      "adopt-index": { type: "boolean" },
      backfill: { type: "boolean" },
      rebuild: { type: "boolean" },
    },
  });

  if (
    !values["adopt-legacy"] &&
    !values["adopt-index"] &&
    !values.backfill &&
    !values.rebuild
  ) {
    fail("pick at least one of --adopt-legacy | --adopt-index | --backfill | --rebuild");
  }

  if (values["adopt-legacy"]) {
    const result = await adoptLegacy();
    console.log(JSON.stringify({ job: "adopt-legacy", ...result }));
  }

  if (values["adopt-index"]) {
    const gap = memoryConfigGap();
    if (gap) fail(`the memory index is unconfigured (${gap} is unset)`);
    const result = await adoptIndexOrphans();
    console.log(JSON.stringify({ job: "adopt-index", ...result }));
  }

  if (values.backfill || values.rebuild) {
    const gap = memoryConfigGap();
    if (gap) {
      fail(
        `the memory index is unconfigured (${gap} is unset) — indexing needs Qdrant, Ollama and ANTHROPIC_API_KEY`,
      );
    }
    const mode = values.rebuild ? "rebuild" : "backfill";
    const result = await reindexMemories(mode);
    console.log(JSON.stringify({ job: mode, ...result }));
  }

  // How much of the record is indexed, so the operator can see the outcome
  // rather than infer it.
  const [state] = await getDb()
    .select({
      live: sql<number>`count(*)::int`,
      indexed: sql<number>`count(${assistantMemory.mem0MemoryId})::int`,
    })
    .from(assistantMemory)
    .where(
      and(isNull(assistantMemory.deletedAt), isNull(assistantMemory.supersededAt)),
    );
  console.log(JSON.stringify({ job: "state", ...state }));
  await getPool().end();
}

main().catch((err) => {
  console.error("[vendra:memory-reindex] failed:", err);
  process.exit(1);
});
