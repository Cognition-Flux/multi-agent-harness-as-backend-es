/**
 * Continuous compliance — the expiry sweep (SPEC §6.8). Time is a
 * first-class trigger: compliance decays with nobody touching anything.
 *
 * Mechanism: an in-process scheduler registered from instrumentation.ts (the
 * app is a single long-lived container), guarded by a Postgres advisory lock
 * so multi-replica deployments never double-run. The tick is a thin pure
 * loop — no model calls anywhere:
 *   select exposed vendors → calculateActivationGate(…, now) → CAS
 *   APPROVED → EXPIRED where the gate breaks → activity + transition rows →
 *   renewal-notification rows (30/14/1-day horizons).
 *
 * Symmetry: a valid renewal upload flows through the normal pipeline; its
 * recompute re-runs the gate and EXPIRED → APPROVED happens on the recompute
 * path with no officer touch (§13.4).
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema, withAdvisoryLock } from "@vendra/db-vendor";
import { vendraError, vendraLog } from "@vendra/workflow/vendor";

import { env } from "@/env";
import { loadVendorEvidence, recomputeBestEffort } from "@/server/recompute";

const { renewalNotification, vendor, vendorActivity, vendorStatusTransition } =
  schema;

/** Advisory-lock key for the sweep (arbitrary, stable). */
const VENDOR_SWEEP_LOCK_KEY = 764_363_001;

const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly horizon-scan
const RENEWAL_HORIZON_DAYS = [30, 14, 1] as const;

const globalStore = globalThis as typeof globalThis & {
  __vendraSweeper?: { timer: NodeJS.Timeout | null; lastTickAt: string | null };
};

const sweeper =
  globalStore.__vendraSweeper ??
  (globalStore.__vendraSweeper = { timer: null, lastTickAt: null });

export function getSweeperLastTickAt(): string | null {
  return sweeper.lastTickAt;
}

export function startSweepScheduler(): void {
  if (sweeper.timer) return;
  const interval = env.VENDOR_SWEEP_INTERVAL_MS ?? DEFAULT_SWEEP_INTERVAL_MS;
  vendraLog("sweep.scheduler_started", { intervalMs: interval });
  const timer = setInterval(() => {
    void runSweepTick();
  }, interval);
  timer.unref();
  sweeper.timer = timer;
  // First tick shortly after boot so a restarted container converges fast.
  const firstTick = setTimeout(() => void runSweepTick(), 30_000);
  firstTick.unref();
}

/** One sweep tick — advisory-locked, safe to invoke concurrently. */
export async function runSweepTick(): Promise<void> {
  const db = getDb();
  const startedAt = Date.now();
  try {
    // The lock lives on ONE PINNED connection (withAdvisoryLock). The previous
    // pool-level pg_try_advisory_lock acquired on one pooled connection and
    // unlocked on whichever was idle later — when they differed, the unlock
    // silently no-oped and the lock stayed glued to a connection serving
    // unrelated traffic, so every future sweep in every process skipped with
    // "lock_held" and expiries stopped being enforced fleet-wide, with nothing
    // in the logs. Found by the §22 memory audit; the drain shared the bug.
    const outcome = await withAdvisoryLock(VENDOR_SWEEP_LOCK_KEY, async () => {
      const now = new Date();
      // Vendors with time-exposed state: anything with an expiry horizon or
      // already APPROVED (the CAS target).
      const exposed = await db
        .select({ id: vendor.id, status: vendor.complianceStatus })
        .from(vendor)
        .where(
          inArray(vendor.complianceStatus, [
            "APPROVED",
            "PRE_APPROVED",
            "EXPIRED",
          ]),
        );

      let expired = 0;
      let restored = 0;
      let notified = 0;
      for (const row of exposed) {
        const loaded = await loadVendorEvidence(db, row.id, now);

        // Round-2 hardening B6: an EXPIRED vendor whose gate re-cleared by
        // time alone (waiver windows, api-check refreshes) restores without
        // waiting for a vendor/officer action — the recompute owns the
        // EXPIRED → APPROVED transition (source "gate").
        if (row.status === "EXPIRED" && loaded.gate.cleared) {
          restored++;
          vendraLog("sweep.restoring", { vendor: row.id });
          await recomputeBestEffort(row.id);
        }

        // APPROVED → EXPIRED where the gate breaks (CAS-guarded).
        if (row.status === "APPROVED" && !loaded.gate.cleared) {
          const flipped = await db
            .update(vendor)
            .set({ complianceStatus: "EXPIRED", updatedAt: sql`now()` })
            .where(
              // Typed CAS guard — eq() checks the literal against the pg enum.
              and(eq(vendor.id, row.id), eq(vendor.complianceStatus, "APPROVED")),
            )
            .returning({ id: vendor.id });
          if (flipped.length > 0) {
            expired++;
            await db.insert(vendorStatusTransition).values({
              vendorId: row.id,
              fromStatus: "APPROVED",
              toStatus: "EXPIRED",
              source: "sweep",
            });
            await db.insert(vendorActivity).values({
              vendorId: row.id,
              organizationId: loaded.vendorRow.organizationId,
              type: "SWEEP_EXPIRED",
              metadata: {
                blocking: loaded.gate.blocking,
                missingMandatory: loaded.gate.missingMandatory,
              },
            });
            vendraLog("sweep.expired", {
              vendor: row.id,
              blocking: loaded.gate.blocking.join(","),
            });
          }
        }

        // Renewal notifications: one row per (category, horizon, dueAt) —
        // idempotent via the unique index; delivery wiring is a fast-follow
        // (v1 writes the rows + activity, §4 non-goals).
        for (const [category, entry] of loaded.evidence.byCategory) {
          if (!entry.granted || !entry.expiresAt) continue;
          const dueAt = entry.expiresAt.slice(0, 10);
          const msUntil = new Date(`${dueAt}T00:00:00Z`).getTime() - now.getTime();
          const daysUntil = msUntil / (24 * 60 * 60 * 1000);
          for (const horizon of RENEWAL_HORIZON_DAYS) {
            if (daysUntil > horizon || daysUntil < 0) continue;
            const inserted = await db
              .insert(renewalNotification)
              .values({
                vendorId: row.id,
                category,
                documentType: null,
                horizonDays: horizon,
                dueAt,
              })
              .onConflictDoNothing()
              .returning({ id: renewalNotification.id });
            if (inserted.length > 0) {
              notified++;
              vendraLog("sweep.renewal_notice", {
                vendor: row.id,
                category,
                horizon,
                dueAt,
              });
            }
          }
        }
      }

      sweeper.lastTickAt = new Date().toISOString();
      vendraLog("sweep.tick_done", {
        vendors: exposed.length,
        expired,
        restored,
        notified,
        ms: Date.now() - startedAt,
      });
    });
    if (!outcome.ran) {
      vendraLog("sweep.skipped", { reason: "lock_held" });
    }
  } catch (err) {
    vendraError("sweep.tick_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
