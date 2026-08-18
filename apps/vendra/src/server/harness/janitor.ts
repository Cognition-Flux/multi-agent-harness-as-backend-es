/**
 * Stale-run reaper (SPEC §6.1) — best-effort on read paths; an error
 * never breaks the snapshot. Each flip re-checks status + staleness at
 * UPDATE time and writes a DOCUMENT_REJECTED activity.
 *
 * - PROCESSING > 25 min → FAILED (orphaned run, e.g. a server restart).
 *   25 min clears the worst legitimate case — the 14-min run cap plus queue
 *   wait behind the 3-slot semaphore plus a 3-min cold sandbox start — so a
 *   queued-but-alive run is never reaped (spec §16 B11).
 * - PENDING > 10 min → FAILED (a presigned PUT that never completed).
 * - UPLOADED > 10 min → FAILED (the officer-retry deadlock sweep, F-3:
 *   nothing auto-claims a reset doc — the vendor's "Try again" re-enters).
 */
import { and, eq, lt, sql } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";

import { insertActivity } from "./db/documents";
import { vendraError, vendraWarn } from "./log";

const { vendorDocument } = schema;

const STALE_PROCESSING_MS = 25 * 60 * 1000;
const STALE_PENDING_MS = 10 * 60 * 1000;
const STALE_UPLOADED_MS = 10 * 60 * 1000;

async function failStale(
  vendorId: number,
  status: "PROCESSING" | "PENDING" | "UPLOADED",
  olderThanMs: number,
  reason: string,
): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await getDb()
    .update(vendorDocument)
    .set({
      uploadStatus: "FAILED",
      fileMetadata: sql`COALESCE(${vendorDocument.fileMetadata}, '{}'::jsonb) || jsonb_build_object('failureReason', ${reason}::text)`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(vendorDocument.vendorId, vendorId),
        eq(vendorDocument.uploadStatus, status),
        lt(vendorDocument.updatedAt, cutoff),
      ),
    )
    .returning({
      id: vendorDocument.id,
      uuid: vendorDocument.uuid,
      organizationId: vendorDocument.organizationId,
    });
  for (const row of rows) {
    vendraWarn("janitor.stale_doc", {
      doc: row.uuid,
      vendor: vendorId,
      was: status,
    });
    await insertActivity({
      vendorId,
      organizationId: row.organizationId,
      type: "DOCUMENT_REJECTED",
      documentId: row.id,
      metadata: { documentUuid: row.uuid, failureReason: reason, janitor: status },
    });
  }
}

export async function failStaleProcessingDocs(vendorId: number): Promise<void> {
  await failStale(
    vendorId,
    "PROCESSING",
    STALE_PROCESSING_MS,
    "Processing was interrupted. Please try again.",
  );
}

export async function failStalePendingDocs(vendorId: number): Promise<void> {
  await failStale(
    vendorId,
    "PENDING",
    STALE_PENDING_MS,
    "The upload never completed. Please upload the file again.",
  );
}

export async function failStaleUploadedDocs(vendorId: number): Promise<void> {
  await failStale(
    vendorId,
    "UPLOADED",
    STALE_UPLOADED_MS,
    "Reprocessing did not start. Please try again.",
  );
}

/** The best-effort janitor pass the snapshot route runs first. */
export async function runJanitor(vendorId: number): Promise<void> {
  try {
    await failStaleProcessingDocs(vendorId);
    await failStalePendingDocs(vendorId);
    await failStaleUploadedDocs(vendorId);
  } catch (err) {
    vendraError("janitor.sweep_skipped", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
