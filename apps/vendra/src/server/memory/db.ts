/**
 * Drizzle access for the memory layer (SPEC §22). Every read and write of
 * `assistant_memory` / `memory_ingest_queue` goes through here (rule 7).
 *
 * `assistant_memory` is the system of record: the semantic index in Qdrant is
 * derived from it and can be rebuilt at will, so nothing in this file may
 * depend on the index being reachable.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";

const { assistantMemory, memoryIngestQueue } = schema;

export interface LiveMemoryRow {
  id: number;
  fact: string;
  mem0MemoryId: string | null;
  createdAt: Date;
}

/** Live facts for a vendor, newest first. The recall fallback reads this. */
export async function listLiveMemories(
  vendorUuid: string,
  limit: number,
): Promise<LiveMemoryRow[]> {
  return getDb()
    .select({
      id: assistantMemory.id,
      fact: assistantMemory.fact,
      mem0MemoryId: assistantMemory.mem0MemoryId,
      createdAt: assistantMemory.createdAt,
    })
    .from(assistantMemory)
    .where(
      and(
        eq(assistantMemory.vendorUuid, vendorUuid),
        isNull(assistantMemory.deletedAt),
        isNull(assistantMemory.supersededAt),
      ),
    )
    .orderBy(desc(assistantMemory.createdAt), desc(assistantMemory.id))
    .limit(limit);
}

/** Facts by mem0 id — how a search result becomes our own record. */
export async function findMemoriesByMem0Ids(
  vendorUuid: string,
  mem0Ids: string[],
): Promise<LiveMemoryRow[]> {
  if (mem0Ids.length === 0) return [];
  return getDb()
    .select({
      id: assistantMemory.id,
      fact: assistantMemory.fact,
      mem0MemoryId: assistantMemory.mem0MemoryId,
      createdAt: assistantMemory.createdAt,
    })
    .from(assistantMemory)
    .where(
      and(
        eq(assistantMemory.vendorUuid, vendorUuid),
        inArray(assistantMemory.mem0MemoryId, mem0Ids),
        isNull(assistantMemory.deletedAt),
      ),
    );
}

/**
 * Record facts the agent chose to store. Returns the rows actually inserted —
 * the partial unique index drops exact duplicates without an error, so a
 * shorter return is the normal "already knew that" path, not a failure.
 */
export async function insertMemories(
  input: {
    vendorId: number;
    vendorUuid: string;
    facts: string[];
    source: "tool" | "extracted";
  },
): Promise<{ id: number; fact: string }[]> {
  if (input.facts.length === 0) return [];
  return getDb()
    .insert(assistantMemory)
    .values(
      input.facts.map((fact) => ({
        vendorId: input.vendorId,
        vendorUuid: input.vendorUuid,
        fact,
        source: input.source,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: assistantMemory.id, fact: assistantMemory.fact });
}

/** Attach mem0's id once the drain has indexed a row. */
export async function linkMem0Id(id: number, mem0MemoryId: string): Promise<void> {
  await getDb()
    .update(assistantMemory)
    .set({ mem0MemoryId })
    .where(eq(assistantMemory.id, id));
}

/**
 * Reconcile a consolidation decision.
 *
 * mem0 may replace a fact with a better-worded one (UPDATE) or decide it is no
 * longer true (DELETE). Either way our record keeps the history: a superseded
 * or deleted row is marked, never removed, so the audit trail survives and a
 * re-index can still explain where a memory came from.
 */
export async function supersedeByMem0Id(mem0MemoryId: string): Promise<void> {
  await getDb()
    .update(assistantMemory)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(assistantMemory.mem0MemoryId, mem0MemoryId),
        isNull(assistantMemory.supersededAt),
      ),
    );
}

export async function softDeleteByMem0Id(mem0MemoryId: string): Promise<void> {
  await getDb()
    .update(assistantMemory)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(assistantMemory.mem0MemoryId, mem0MemoryId),
        isNull(assistantMemory.deletedAt),
      ),
    );
}

/** Upsert an extracted fact and return its row id, for id linkage. */
export async function recordExtractedFact(input: {
  vendorId: number;
  vendorUuid: string;
  fact: string;
  mem0MemoryId: string;
}): Promise<void> {
  const [row] = await getDb()
    .insert(assistantMemory)
    .values({
      vendorId: input.vendorId,
      vendorUuid: input.vendorUuid,
      fact: input.fact,
      source: "extracted",
      mem0MemoryId: input.mem0MemoryId,
    })
    .onConflictDoNothing()
    .returning({ id: assistantMemory.id });
  // The fact already existed verbatim (the live partial unique fired). Adopt
  // mem0's id onto the existing row so future UPDATE/DELETE decisions can find
  // it — otherwise the record and the index drift apart.
  if (!row) {
    await getDb()
      .update(assistantMemory)
      .set({ mem0MemoryId: input.mem0MemoryId })
      .where(
        and(
          eq(assistantMemory.vendorUuid, input.vendorUuid),
          eq(assistantMemory.fact, input.fact),
          isNull(assistantMemory.deletedAt),
          isNull(assistantMemory.mem0MemoryId),
        ),
      );
  }
}

// =============================================================================
// The ingest queue
// =============================================================================

export interface QueuedWork {
  id: number;
  vendorId: number;
  vendorUuid: string;
  threadId: string;
  kind: string;
  payload: unknown;
  attempts: number;
}

export async function enqueueMemoryWork(input: {
  vendorId: number;
  vendorUuid: string;
  threadId: string;
  kind: "turn" | "fact";
  payload: unknown;
}): Promise<void> {
  await getDb().insert(memoryIngestQueue).values({
    vendorId: input.vendorId,
    vendorUuid: input.vendorUuid,
    threadId: input.threadId,
    kind: input.kind,
    payload: input.payload,
  });
}

/**
 * Claim a batch of pending work.
 *
 * `FOR UPDATE SKIP LOCKED` is the point: two drains (dev server + a container,
 * or two app replicas) can run at once and will never hand the same row to
 * both. The advisory lock in `drain.ts` bounds concurrency further, but this
 * makes correctness independent of it.
 *
 * The builder has no `SKIP LOCKED`, which is exactly the narrow case rule 7
 * allows the parameterized `sql` tag for.
 */
export async function claimMemoryWork(
  limit: number,
  staleLockMs: number,
): Promise<QueuedWork[]> {
  const staleBefore = new Date(Date.now() - staleLockMs);
  const claimed = await getDb().execute<{
    id: number;
    vendor_id: number;
    vendor_uuid: string;
    thread_id: string;
    kind: string;
    payload: unknown;
    attempts: number;
  }>(sql`
    WITH claimable AS (
      SELECT id FROM memory_ingest_queue
      WHERE processed_at IS NULL
        AND (locked_at IS NULL OR locked_at < ${staleBefore})
      ORDER BY created_at ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE memory_ingest_queue q
       SET locked_at = now(), attempts = q.attempts + 1
      FROM claimable c
     WHERE q.id = c.id
    RETURNING q.id, q.vendor_id, q.vendor_uuid, q.thread_id, q.kind,
              q.payload, q.attempts
  `);
  return claimed.rows.map((row) => ({
    id: row.id,
    vendorId: row.vendor_id,
    vendorUuid: row.vendor_uuid,
    threadId: row.thread_id,
    kind: row.kind,
    payload: row.payload,
    attempts: row.attempts,
  }));
}

export async function completeMemoryWork(id: number): Promise<void> {
  await getDb()
    .update(memoryIngestQueue)
    .set({ processedAt: new Date(), lockedAt: null, error: null })
    .where(eq(memoryIngestQueue.id, id));
}

/**
 * Release a failed item for retry, or bury it past the attempt cap.
 *
 * Burying matters: a permanently malformed payload that retries forever would
 * starve the queue and bill an extraction call every tick.
 */
export async function failMemoryWork(
  id: number,
  attempts: number,
  maxAttempts: number,
  error: string,
): Promise<void> {
  const buried = attempts >= maxAttempts;
  await getDb()
    .update(memoryIngestQueue)
    .set({
      lockedAt: null,
      error: error.slice(0, 500),
      ...(buried ? { processedAt: new Date() } : {}),
    })
    .where(eq(memoryIngestQueue.id, id));
}

/** Pending depth, for /api/health. */
export async function pendingMemoryWorkCount(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(memoryIngestQueue)
    .where(isNull(memoryIngestQueue.processedAt));
  return row?.n ?? 0;
}

/** Rows whose index entry is missing — the re-index worklist. */
export async function listUnindexedMemories(
  limit: number,
): Promise<(LiveMemoryRow & { vendorId: number; vendorUuid: string })[]> {
  return getDb()
    .select({
      id: assistantMemory.id,
      fact: assistantMemory.fact,
      mem0MemoryId: assistantMemory.mem0MemoryId,
      createdAt: assistantMemory.createdAt,
      vendorId: assistantMemory.vendorId,
      vendorUuid: assistantMemory.vendorUuid,
    })
    .from(assistantMemory)
    .where(
      and(
        isNull(assistantMemory.mem0MemoryId),
        isNull(assistantMemory.deletedAt),
        isNull(assistantMemory.supersededAt),
      ),
    )
    .orderBy(asc(assistantMemory.id))
    .limit(limit);
}

/** Everything live, for a full rebuild after a lost Qdrant volume. */
export async function listAllLiveMemories(): Promise<
  (LiveMemoryRow & { vendorId: number; vendorUuid: string })[]
> {
  return getDb()
    .select({
      id: assistantMemory.id,
      fact: assistantMemory.fact,
      mem0MemoryId: assistantMemory.mem0MemoryId,
      createdAt: assistantMemory.createdAt,
      vendorId: assistantMemory.vendorId,
      vendorUuid: assistantMemory.vendorUuid,
    })
    .from(assistantMemory)
    .where(
      and(
        isNull(assistantMemory.deletedAt),
        isNull(assistantMemory.supersededAt),
      ),
    )
    .orderBy(asc(assistantMemory.vendorUuid), asc(assistantMemory.id));
}

/** Drop index ids on every live row so a full rebuild re-links them. */
export async function clearMem0Ids(): Promise<number> {
  const rows = await getDb()
    .update(assistantMemory)
    .set({ mem0MemoryId: null })
    .where(isNull(assistantMemory.deletedAt))
    .returning({ id: assistantMemory.id });
  return rows.length;
}
