/**
 * POST /api/vendor/documents/[uuid]/process — the per-document SSE pipeline
 * route (SPEC §6.4). One Claude Code harness session per document; the
 * agent decides classification + extraction via host tools; validation,
 * HITL gates, requirement verification, and every DB transition are
 * host-computed.
 *
 * Disconnect semantics (design R5): the abort deliberately EXCLUDES
 * req.signal — a closed tab must not kill processing; the client reconverges
 * via the snapshot poll. AbortSignal.timeout is the only abort source.
 *
 * Run-settle failsafe: keyed off the RUN settling (execute's
 * finally), NEVER the stream closing — onEnd also fires on client
 * disconnect / proxy idle-kill while the run continues detached, and failing
 * the doc from there raced and suppressed the detached run's real verdict.
 *
 * Pre-stream guard: /process pre-checks the harness creds guard and
 * returns a named 503 BEFORE opening the stream (§9.1).
 */
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import type { VendorDocUIMessage } from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { authFailureResponse, requireOwnedDocument } from "@/server/auth-guards";
import {
  DOC_RUN_TIMEOUT_MS,
  buildVendorDocRunContext,
  claimAndPrepareVendorDocRun,
  executeClaimedVendorDocRun,
} from "@/server/harness/doc-run";
import { runCoverageDetermination } from "@/server/harness/coverage-runner";
import { vendraError, vendraWarn } from "@/server/harness/log";
import {
  classifyHarnessError,
  harnessErrorFields,
  missingHarnessCredentialNames,
} from "@/server/harness/sandbox";
import { failVendorDocumentInternal } from "@/server/harness/tools";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid: documentUuid } = await params;

  // Body is a useChat message envelope; its content is deliberately ignored —
  // every input loads from the DB row + storage (the client cannot steer).
  await req.json().catch(() => undefined);

  // Named 503 BEFORE opening the stream when the harness is unconfigured.
  const missing = missingHarnessCredentialNames();
  if (missing.length > 0) {
    vendraWarn("process.rejected", {
      doc: documentUuid,
      reason: "harness_unconfigured",
      missing: missing.join(","),
    });
    return Response.json(
      {
        error: `Claude Code harness is not configured — missing: ${missing.join(", ")}`,
      },
      { status: 503 },
    );
  }

  let auth: Awaited<ReturnType<typeof requireOwnedDocument>>;
  try {
    auth = await requireOwnedDocument(documentUuid);
  } catch (err) {
    // A guard-layer throw here is a transient service condition (a DB blip),
    // not a caller error — 503 invites the retry a 500 discourages (§16 B9).
    vendraError("process.precheck_failed", {
      doc: documentUuid,
      cause: "auth_or_context",
      message: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      { error: "Document could not be loaded for processing — try again shortly" },
      { status: 503 },
    );
  }
  if (!auth.ok) {
    vendraWarn("process.rejected", { doc: documentUuid, reason: auth.failure.kind });
    return authFailureResponse(auth.failure);
  }
  const run = auth.run;

  const claim = await claimAndPrepareVendorDocRun(run);
  if (!claim.ok) {
    vendraWarn("process.rejected", {
      doc: documentUuid,
      vendor: run.vendor.id,
      reason: claim.reason,
      prior: run.document.uploadStatus,
    });
    switch (claim.reason) {
      case "no_media_type":
        return Response.json(
          { error: "Document has no accepted media type on record" },
          { status: 422 },
        );
      case "not_claimable":
        return Response.json(
          { error: "Document is not in a processable state" },
          { status: 409 },
        );
      case "missing_bytes":
        return Response.json({ error: "Uploaded file missing" }, { status: 410 });
    }
  }
  const prepared = claim.prepared;

  // R5: timeout-only — deliberately NOT req.signal.
  const signal = AbortSignal.timeout(DOC_RUN_TIMEOUT_MS);

  // Built with the noop writer; the live writer is installed inside execute,
  // so pre-stream and post-stream failure paths stay DB-only.
  const ctx = buildVendorDocRunContext(prepared);

  const stream = createUIMessageStream<VendorDocUIMessage>({
    execute: async ({ writer }) => {
      ctx.writer = writer;
      try {
        await executeClaimedVendorDocRun(ctx, prepared, { signal });
      } finally {
        // Run-settle failsafe — keyed off the RUN settling, never the
        // stream closing.
        ctx.runSettled = true;
        if (!ctx.terminalWritten) {
          vendraWarn("process.interrupted", {
            doc: documentUuid,
            vendor: run.vendor.id,
            source: "run_settled_no_terminal",
          });
          await failVendorDocumentInternal(ctx, "Processing was interrupted.").catch(
            (err) =>
              vendraError("process.safety_net", {
                doc: documentUuid,
                error: err instanceof Error ? err.message : String(err),
              }),
          );
        }
        // Kick the coverage determination (detached, best-effort) AFTER this
        // run's semaphore slot is released — executeClaimedVendorDocRun owns
        // teardown in its finally, so the slot is free by now. Kicking at
        // run-settle means the determination always sees this document's
        // final verdict, even when the client disconnected.
        runCoverageDetermination(ctx.run.vendor.id);
      }
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      // The merged inner stream and the execute throw can both surface the
      // same root error — log it ONCE.
      if (!ctx.errorLogged) {
        ctx.errorLogged = true;
        vendraError("process.error", {
          doc: documentUuid,
          vendor: run.vendor.id,
          cause: classifyHarnessError(err, signal),
          ...harnessErrorFields(err),
        });
      }
      return `process: ${message}`;
    },
    onEnd: () => {
      // Observability only — the doc-affecting failsafe lives in execute's
      // finally, keyed off the run settling.
      if (!ctx.runSettled) {
        vendraWarn("process.stream_closed_early", {
          doc: documentUuid,
          vendor: run.vendor.id,
        });
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
