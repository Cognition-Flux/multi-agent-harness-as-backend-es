/**
 * The memory drain (SPEC §22) — where consolidation actually happens.
 *
 * Runs on its own short interval, NOT on the existing sweep tick: that one is
 * hourly (`server/sweep.ts`), which would leave a vendor's memory up to an hour
 * behind the conversation. The pattern is copied from it deliberately —
 * globalThis singleton so Next's module reloads cannot start two, an
 * `unref()`ed timer so it never holds the process open, and a Postgres advisory
 * lock so several app instances converge instead of competing.
 *
 * What the drain does with mem0's answer: `add()` returns decisions, and each
 * is reconciled onto `assistant_memory`. **In the installed mem0ai@3.1.6 the
 * extraction pipeline is ADDITIVE-ONLY** (its prompt says "your sole operation
 * is ADD"), so in practice only ADD and "already known → no decision" occur:
 * near-duplicates are prevented because mem0 sees the existing memories and
 * declines to re-add, but a CONTRADICTED fact is not superseded — the stale one
 * stays until an officer-facing surface or a future SDK restores UPDATE/DELETE.
 * The UPDATE/DELETE branches below are kept deliberately: they are the correct
 * reconciliation if an upgrade turns those events back on, and both event
 * shapes (`metadata.event` and top-level) are accepted.
 *
 *   ADD    → a fact we did not have: record it with mem0's id.
 *   UPDATE → (3.1.6: not emitted) supersede the old row, record the new text.
 *   DELETE → (3.1.6: not emitted) soft-delete.
 *   none   → mem0 already knew this; nothing to do.
 *
 * One loss window is real and repaired elsewhere: a crash between `add()`
 * committing to Qdrant and the reconcile writes means the retry's `add()`
 * dedupes to zero decisions and the fact would exist only in the index.
 * `memory-reindex --adopt-index` closes it by diffing mem0's memories against
 * the record and adopting the orphans.
 */
import { withAdvisoryLock } from "@vendra/db-vendor";

import { env } from "@/env";
import { vendraError, vendraLog, vendraWarn } from "@/server/harness/log";

import { MEMORY_AGENT_ID } from "./config";
import {
  claimMemoryWork,
  completeMemoryWork,
  failMemoryWork,
  linkMem0Id,
  recordExtractedFact,
  softDeleteByMem0Id,
  supersedeByMem0Id,
  type QueuedWork,
} from "./db";
import { getMemoryClient, probeMemoryBackends } from "./mem0-client";
import { redactMemoryFact } from "./redact";

/** Distinct from the sweep's lock key — the two must never block each other. */
const MEMORY_DRAIN_LOCK_KEY = 981_144_701;
const DEFAULT_DRAIN_INTERVAL_MS = 20_000;
const BATCH_SIZE = 5;
/**
 * Attempts before burial. Generous on purpose: the probe gate below stops
 * attempts from burning while Qdrant/Ollama are down, but an Anthropic-side
 * outage still costs one attempt per tick, and a buried TURN is gone for good
 * (the payload is a turn, not a record row — no backfill recovers it). A live
 * round watched an item reach the old cap of 3 during a ~60 s container stop.
 */
const MAX_ATTEMPTS = 5;
/** A claim older than this is assumed dead (crashed mid-drain) and reclaimable. */
const STALE_LOCK_MS = 5 * 60 * 1000;

const globalStore = globalThis as typeof globalThis & {
  __vendraMemoryDrain?: {
    timer: NodeJS.Timeout | null;
    lastTickAt: string | null;
    running: boolean;
  };
};

const drain =
  globalStore.__vendraMemoryDrain ??
  (globalStore.__vendraMemoryDrain = {
    timer: null,
    lastTickAt: null,
    running: false,
  });

export function getMemoryDrainLastTickAt(): string | null {
  return drain.lastTickAt;
}

export function startMemoryDrainScheduler(): void {
  if (drain.timer) return;
  const interval = env.VENDOR_MEMORY_DRAIN_INTERVAL_MS ?? DEFAULT_DRAIN_INTERVAL_MS;
  vendraLog("memory.drain_scheduler_started", { intervalMs: interval });
  const timer = setInterval(() => {
    void runMemoryDrainTick();
  }, interval);
  timer.unref();
  drain.timer = timer;
}

/**
 * One drain tick. Safe to call concurrently: the advisory lock bounds it, and
 * the claim query uses `FOR UPDATE SKIP LOCKED` so correctness does not depend
 * on the lock at all.
 */
export async function runMemoryDrainTick(): Promise<void> {
  // A tick that overruns its interval must not stack up behind itself.
  if (drain.running) return;
  drain.running = true;
  const startedAt = Date.now();
  try {
    // Single-flight across processes via a lock held on ONE PINNED connection
    // (withAdvisoryLock). The obvious pool-level pg_try_advisory_lock is a
    // trap: acquire and unlock land on different pooled connections under
    // load, the unlock silently no-ops, and every drain in every process is
    // locked out until that connection dies — the audit confirmed it and the
    // sweep shared the bug. Correctness still never depends on the lock:
    // claimMemoryWork uses FOR UPDATE SKIP LOCKED.
    const outcome = await withAdvisoryLock(MEMORY_DRAIN_LOCK_KEY, async () => {
      const client = await getMemoryClient();
      if (!client) return; // unconfigured: leave the queue for later

      // Probe gate: with the index or the embedder down, every item would
      // fail, and each failure burns an attempt toward burial — a plain
      // container restart could bury turns permanently. Skip the tick and let
      // the queue wait; the backends' health is /api/health's job to report.
      const backends = await probeMemoryBackends();
      if (!backends.qdrant || !backends.ollama) {
        vendraWarn("memory.drain_skipped", {
          qdrant: backends.qdrant,
          ollama: backends.ollama,
        });
        return;
      }

      const batch = await claimMemoryWork(BATCH_SIZE, STALE_LOCK_MS);
      if (batch.length === 0) {
        drain.lastTickAt = new Date().toISOString();
        return;
      }
      let added = 0;
      let updated = 0;
      let deleted = 0;
      for (const item of batch) {
        try {
          const counts = await processItem(client, item);
          added += counts.added;
          updated += counts.updated;
          deleted += counts.deleted;
          await completeMemoryWork(item.id, item.claimedAt);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await failMemoryWork(item, MAX_ATTEMPTS, message);
          vendraWarn("memory.drain_item_failed", {
            item: item.id,
            vendor: item.vendorUuid,
            attempts: item.attempts,
            buried: item.attempts >= MAX_ATTEMPTS,
            err: message,
          });
        }
      }
      drain.lastTickAt = new Date().toISOString();
      vendraLog("memory.drain_tick", {
        claimed: batch.length,
        added,
        updated,
        deleted,
        ms: Date.now() - startedAt,
      });
    });
    if (!outcome.ran) return; // another process holds the tick
  } catch (err) {
    vendraError("memory.drain_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  } finally {
    drain.running = false;
  }
}

type Mem0Client = NonNullable<Awaited<ReturnType<typeof getMemoryClient>>>;

/**
 * One decision from `add()`.
 *
 * The event lives in `metadata.event` in 3.1.6 — NOT at the top level, which is
 * where older mem0 put it and where the obvious guess reads it. Getting this
 * wrong is silent: every branch below misses, the drain reports
 * `added=0 updated=0 deleted=0`, and the memory lands in Qdrant while our
 * record stays empty. Both shapes are accepted so an upgrade cannot re-break it.
 */
interface Decision {
  id?: string;
  memory?: string;
  event?: string;
  metadata?: { event?: string };
}

function decisionEvent(decision: Decision): string {
  return (decision.metadata?.event ?? decision.event ?? "").toUpperCase();
}

async function processItem(
  client: Mem0Client,
  item: QueuedWork,
): Promise<{ added: number; updated: number; deleted: number }> {
  const payload = item.payload as
    | { text?: string }
    | { rows?: { id: number; fact: string }[] };

  // A `fact` item is already in the record; it only needs indexing, so it goes
  // in verbatim with inference OFF. Running extraction over a fact the agent
  // already distilled would just paraphrase it into a near-duplicate.
  if ("rows" in payload && Array.isArray(payload.rows)) {
    let added = 0;
    for (const row of payload.rows) {
      const result = await client.add(row.fact, {
        userId: item.vendorUuid,
        agentId: MEMORY_AGENT_ID,
        runId: item.threadId,
        infer: false,
        metadata: { source: "tool" },
      });
      const first = (result.results ?? [])[0] as Decision | undefined;
      if (first?.id) {
        await linkMem0Id(row.id, first.id);
        added += 1;
      }
    }
    return { added, updated: 0, deleted: 0 };
  }

  const text = "text" in payload ? payload.text?.trim() : undefined;
  if (!text) return { added: 0, updated: 0, deleted: 0 };

  // The extraction pass: mem0 reads the turn, decides what is durable, and
  // reconciles it against what it already knows for this vendor.
  const result = await client.add([{ role: "user", content: text }], {
    userId: item.vendorUuid,
    agentId: MEMORY_AGENT_ID,
    runId: item.threadId,
    infer: true,
    metadata: { source: "extracted" },
  });

  let added = 0;
  let updated = 0;
  let deleted = 0;
  for (const raw of result.results ?? []) {
    const decision = raw as Decision;
    const event = decisionEvent(decision);
    // Redact again on the way in: these facts were written by a model from
    // vendor prose, not chosen by the agent, so this is the first point at
    // which anyone has vetted them. A prompt is a request; a regex is a
    // guarantee.
    const fact = decision.memory ? redactMemoryFact(decision.memory) : "";
    if (event === "DELETE" && decision.id) {
      await softDeleteByMem0Id(decision.id);
      deleted += 1;
      continue;
    }
    if (!fact || !decision.id) continue;
    if (event === "UPDATE") {
      await supersedeByMem0Id(decision.id);
      await recordExtractedFact({
        vendorId: item.vendorId,
        vendorUuid: item.vendorUuid,
        fact,
        mem0MemoryId: decision.id,
      });
      updated += 1;
      continue;
    }
    if (event === "ADD") {
      await recordExtractedFact({
        vendorId: item.vendorId,
        vendorUuid: item.vendorUuid,
        fact,
        mem0MemoryId: decision.id,
      });
      added += 1;
    }
    // NONE / anything unrecognised: mem0 already knew this. Nothing to do.
  }
  return { added, updated, deleted };
}
