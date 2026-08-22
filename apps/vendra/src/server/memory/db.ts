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
 *
 * `vendorUuid` is the SCOPE KEY handed to mem0 as userId: a vendor uuid, or
 * `org:<orgUuid>` for org-scoped directive facts (SPEC §24.6) — then vendorId
 * is null and organizationId is set.
 */
export async function insertMemories(
  input: {
    vendorId: number | null;
    organizationId?: number | null;
    vendorUuid: string;
    facts: string[];
    source: "tool" | "extracted" | "directive";
    knobKey?: string | null;
  },
): Promise<{ id: number; fact: string }[]> {
  if (input.facts.length === 0) return [];
  return getDb()
    .insert(assistantMemory)
    .values(
      input.facts.map((fact) => ({
        vendorId: input.vendorId,
        organizationId: input.organizationId ?? null,
        vendorUuid: input.vendorUuid,
        fact,
        source: input.source,
        knobKey: input.knobKey ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: assistantMemory.id, fact: assistantMemory.fact });
}

/**
 * Supersede the live directive facts for the given knobs in one scope (SPEC
 * §24.6) — the Postgres half of "an approved change replaces the previous
 * directive for the same knob". Returns the affected rows' mem0 ids so the
 * caller can best-effort delete them from the index (mem0 is additive-only;
 * `--rebuild` remains the guaranteed cleanup).
 */
export async function supersedeDirectiveFactsByKnob(
  scopeKey: string,
  knobKeys: readonly string[],
): Promise<{ mem0MemoryIds: string[] }> {
  if (knobKeys.length === 0) return { mem0MemoryIds: [] };
  const rows = await getDb()
    .update(assistantMemory)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(assistantMemory.vendorUuid, scopeKey),
        eq(assistantMemory.source, "directive"),
        inArray(assistantMemory.knobKey, [...knobKeys]),
        isNull(assistantMemory.deletedAt),
        isNull(assistantMemory.supersededAt),
      ),
    )
    .returning({ mem0MemoryId: assistantMemory.mem0MemoryId });
  return {
    mem0MemoryIds: rows
      .map((r) => r.mem0MemoryId)
      .filter((v): v is string => !!v),
  };
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
  vendorId: number | null;
  organizationId?: number | null;
  vendorUuid: string;
  fact: string;
  mem0MemoryId: string;
  source?: "extracted" | "directive";
}): Promise<void> {
  const [row] = await getDb()
    .insert(assistantMemory)
    .values({
      vendorId: input.vendorId,
      organizationId: input.organizationId ?? null,
      vendorUuid: input.vendorUuid,
      fact: input.fact,
      source: input.source ?? "extracted",
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
  /** Null for org-scoped fact work (SPEC §24.6). */
  vendorId: number | null;
  vendorUuid: string;
  threadId: string;
  kind: string;
  payload: unknown;
  attempts: number;
  /**
   * The locked_at this claim stamped — the fencing token for complete/fail.
   *
   * Kept as the RAW STRING node-postgres returned, never coerced to Date:
   * Postgres timestamps carry microseconds, a JS Date truncates to
   * milliseconds, and a truncated fence matches nothing — every item would
   * retry forever and none could complete or bury. Comparisons cast the
   * string back (`::timestamp`), which round-trips the exact stored value.
   */
  claimedAt: string;
}

export async function enqueueMemoryWork(input: {
  vendorId: number | null;
  organizationId?: number | null;
  vendorUuid: string;
  threadId: string;
  kind: "turn" | "fact";
  payload: unknown;
}): Promise<void> {
  await getDb().insert(memoryIngestQueue).values({
    vendorId: input.vendorId,
    organizationId: input.organizationId ?? null,
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
  // Staleness is computed ENTIRELY on the database clock. The first version
  // compared Postgres now() (written into a timestamp-without-tz column)
  // against a JS Date parameter — node-postgres serializes a Date as LOCAL
  // wall time with an offset the timestamp cast then discards, so on this
  // very machine (America/Santiago vs a UTC container) "stale after 5 min"
  // silently became "stale after ~4 h". The audit reproduced it live in psql.
  const claimed = await getDb().execute<{
    id: number;
    vendor_id: number;
    vendor_uuid: string;
    thread_id: string;
    kind: string;
    payload: unknown;
    attempts: number;
    locked_at: string;
  }>(sql`
    WITH claimable AS (
      SELECT id FROM memory_ingest_queue
      WHERE processed_at IS NULL
        AND (locked_at IS NULL
             OR locked_at < now() - make_interval(secs => ${staleLockMs} / 1000.0))
      ORDER BY created_at ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE memory_ingest_queue q
       SET locked_at = clock_timestamp(), attempts = q.attempts + 1
      FROM claimable c
     WHERE q.id = c.id
    RETURNING q.id, q.vendor_id, q.vendor_uuid, q.thread_id, q.kind,
              q.payload, q.attempts, q.locked_at
  `);
  return claimed.rows.map((row) => ({
    id: row.id,
    vendorId: row.vendor_id,
    vendorUuid: row.vendor_uuid,
    threadId: row.thread_id,
    kind: row.kind,
    payload: row.payload,
    attempts: row.attempts,
    claimedAt: row.locked_at,
  }));
}

/**
 * Mark an item done — fenced on the claim stamp.
 *
 * The fence closes a double-processing hole: a batch slower than
 * STALE_LOCK_MS lets another drain reclaim the row (stamping a NEW
 * locked_at); when the original holder finishes late, its unfenced complete
 * would have marked work done that the second holder is still doing — or
 * clobbered its failure bookkeeping. With the fence, the late writer's
 * UPDATE matches zero rows and the reclaim's outcome wins.
 *
 * The payload is scrubbed at the same moment. The queue is a work ledger,
 * not a transcript: a processed row's payload is raw vendor prose serving no
 * further purpose, and prose is where PII lives. (Enqueue also redacts —
 * this is the second layer, and it also empties rows written before
 * redaction-at-enqueue existed as they complete.)
 */
export async function completeMemoryWork(id: number, claimedAt: string): Promise<void> {
  await getDb()
    .update(memoryIngestQueue)
    .set({
      processedAt: new Date(),
      lockedAt: null,
      error: null,
      payload: {},
    })
    .where(
      and(
        eq(memoryIngestQueue.id, id),
        // Raw-string fence — see QueuedWork.claimedAt for why not a Date.
        sql`${memoryIngestQueue.lockedAt} = ${claimedAt}::timestamp`,
      ),
    );
}

/**
 * Release a failed item for retry, or bury it past the attempt cap.
 *
 * Burying matters: a permanently malformed payload that retries forever would
 * starve the queue and bill an extraction call every tick.
 */
export async function failMemoryWork(
  item: { id: number; attempts: number; claimedAt: string },
  maxAttempts: number,
  error: string,
): Promise<void> {
  const buried = item.attempts >= maxAttempts;
  await getDb()
    .update(memoryIngestQueue)
    .set({
      lockedAt: null,
      error: error.slice(0, 500),
      // A buried row's payload is scrubbed for the same reason as a completed
      // one's — and burial makes it MORE important, because a poisoned turn
      // that will never be retried should not preserve its prose forever.
      ...(buried ? { processedAt: new Date(), payload: {} } : {}),
    })
    .where(
      and(
        eq(memoryIngestQueue.id, item.id),
        // Raw-string fence — see QueuedWork.claimedAt for why not a Date.
        sql`${memoryIngestQueue.lockedAt} = ${item.claimedAt}::timestamp`,
      ),
    );
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
): Promise<(LiveMemoryRow & { vendorId: number | null; vendorUuid: string })[]> {
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

/**
 * Every mem0 id this vendor's record has EVER linked — including superseded
 * and soft-deleted rows. The adopt pass diffs the index against this set: an
 * id in mem0 but in no row at all is an orphan (a crash landed between mem0's
 * write and ours), while an id on a superseded/deleted row is history working
 * as designed and must not be re-adopted.
 */
export async function listAllMem0Ids(vendorUuid: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ mem0MemoryId: assistantMemory.mem0MemoryId })
    .from(assistantMemory)
    .where(eq(assistantMemory.vendorUuid, vendorUuid));
  return new Set(
    rows.map((r) => r.mem0MemoryId).filter((v): v is string => !!v),
  );
}

/** Everything live, for a full rebuild after a lost Qdrant volume. */
export async function listAllLiveMemories(): Promise<
  (LiveMemoryRow & { vendorId: number | null; vendorUuid: string })[]
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
