/**
 * GET /api/health — readiness (SPEC §9.6): db pings via Drizzle, storage
 * HEAD-checks the bucket, harness reports the creds-guard result WITHOUT
 * attempting a sandbox create (cheap + honest), sweeper reports its last
 * tick, and memory reports the index's reachability + queue depth. The compose
 * healthcheck probes this route.
 *
 * The memory block is deliberately NOT part of `ok`: the assistant falls back
 * to recency recall when the index is down (§22), so a stopped Qdrant must not
 * mark the whole app unhealthy and get the container restarted.
 */
import { sql } from "drizzle-orm";

import { getDb } from "@vendra/db-vendor";

import { missingHarnessCredentialNames } from "@/server/harness/sandbox";
import { checkStorageHealth } from "@/server/storage";
import { memoryConfigGap } from "@/server/memory/config";
import { getMemoryDrainLastTickAt } from "@/server/memory/drain";
import { pendingMemoryWorkCount } from "@/server/memory/db";
import { probeMemoryBackends } from "@/server/memory/mem0-client";
import { getSweeperLastTickAt } from "@/server/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let db: "ok" | "error" = "ok";
  try {
    await getDb().execute(sql`SELECT 1`);
  } catch {
    db = "error";
  }
  const storage = (await checkStorageHealth()) ? "ok" : "error";
  const memory = await memoryHealth();
  const missing = missingHarnessCredentialNames();
  const harness = missing.length === 0 ? "ok" : "unconfigured";
  const body = {
    db,
    storage,
    harness,
    ...(missing.length > 0 ? { missing } : {}),
    sweeper: { lastTickAt: getSweeperLastTickAt() },
    memory,
  };
  const ok = db === "ok" && storage === "ok";
  return Response.json(body, { status: ok ? 200 : 503 });
}

/**
 * Memory-layer readiness. Three states, mirroring the harness's idiom:
 * `unconfigured` (a knob is unset), `degraded` (configured but a backend is
 * unreachable — recall is falling back to recency), `ok`.
 */
async function memoryHealth(): Promise<Record<string, unknown>> {
  const gap = memoryConfigGap();
  if (gap) return { status: "unconfigured", missing: gap };
  const [backends, pending] = await Promise.all([
    probeMemoryBackends(),
    pendingMemoryWorkCount().catch(() => -1),
  ]);
  const status = backends.qdrant && backends.ollama ? "ok" : "degraded";
  return {
    status,
    qdrant: backends.qdrant ? "ok" : "unreachable",
    ollama: backends.ollama ? "ok" : "unreachable",
    queueDepth: pending,
    drainLastTickAt: getMemoryDrainLastTickAt(),
  };
}
