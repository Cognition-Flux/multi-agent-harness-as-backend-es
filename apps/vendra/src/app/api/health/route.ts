/**
 * GET /api/health — readiness (SPEC §9.6): db pings via Drizzle, storage
 * HEAD-checks the bucket, harness reports the creds-guard result WITHOUT
 * attempting a sandbox create (cheap + honest), sweeper reports its last
 * tick. The compose healthcheck probes this route.
 */
import { sql } from "drizzle-orm";

import { getDb } from "@vendra/db-vendor";

import { missingHarnessCredentialNames } from "@/server/harness/sandbox";
import { checkStorageHealth } from "@/server/storage";
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
  const missing = missingHarnessCredentialNames();
  const harness = missing.length === 0 ? "ok" : "unconfigured";
  const body = {
    db,
    storage,
    harness,
    ...(missing.length > 0 ? { missing } : {}),
    sweeper: { lastTickAt: getSweeperLastTickAt() },
  };
  const ok = db === "ok" && storage === "ok";
  return Response.json(body, { status: ok ? 200 : 503 });
}
