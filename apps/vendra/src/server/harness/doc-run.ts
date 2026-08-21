/**
 * Shared per-document harness run core (SPEC §6.1).
 *
 * Split: `claimAndPrepareVendorDocRun` owns the CAS claim + storage byte
 * verification (each failure maps to the route's status codes via a
 * discriminated result); `buildVendorDocRunContext` assembles the tool
 * context; `executeClaimedVendorDocRun` runs the semaphore-gated harness
 * session and owns session teardown in its finally — so by the time it
 * settles, the slot is released and the caller may kick the coverage
 * determination.
 */
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { toUIMessageStream, type UIMessageStreamWriter } from "ai";
import path from "node:path";

import { env } from "@/env";
import type {
  AcceptedMimeType,
  VendorDocUIMessage,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";
import {
  ACCEPTED_MIME_TYPES,
  EXTENSION_BY_MIME,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { readDocumentBytes } from "@/server/storage";
import { toRequirementProfile, toThresholds, toWorkProfile } from "@/server/profile";

import {
  deriveAllowedDocumentTypes,
  effectiveAllowedDocumentTypes,
  type VendorDocumentType,
} from "@vendra/workflow/vendor";

import { CONFIRMATION_WINDOW_MS } from "./confirmations";
import type { DocumentRunContext } from "./db/documents";
import { casToProcessing, insertActivity } from "./db/documents";
import { vendraError, vendraLog, vendraWarn } from "./log";
import { buildDocPrompt } from "./prompt";
import {
  classifyHarnessError,
  getHarnessFileReporter,
  getHarnessSemaphore,
  getSharedSandboxProvider,
  harnessErrorFields,
} from "./sandbox";
import type { DocRunToolContext } from "./tools";
import { buildVendorDocTools, failVendorDocumentInternal, writeStage } from "./tools";

// Worst legitimate case: cold sandbox+bridge bootstrap (~3 min) + the run
// (~1-2 min) + a full 5-min HITL fail-open window, with headroom.
export const DOC_RUN_TIMEOUT_MS = 840_000;

// Total run attempts per document before the failure is declared. Attempt 2
// runs on a fresh session, so transient sandbox/model blips self-heal. Never
// engages when a terminal was written, a HITL window opened, or the run
// budget aborted.
export const DOC_RUN_MAX_ATTEMPTS = 2;

/** Queue waits above this are worth a log line (frameless window #1). */
const QUEUE_WAIT_LOG_MS = 5_000;

/** Stream-less writer for paths where no response stream exists. */
export const noopDocRunWriter = {
  write: () => undefined,
  merge: () => undefined,
} as unknown as UIMessageStreamWriter<VendorDocUIMessage>;

export function fileNameOf(run: DocumentRunContext): string {
  const meta = (run.document.fileMetadata ?? {}) as Record<string, unknown>;
  return typeof meta.fileName === "string"
    ? meta.fileName
    : path.basename(run.document.fileKey);
}

export function mediaTypeOf(run: DocumentRunContext): AcceptedMimeType | null {
  const meta = (run.document.fileMetadata ?? {}) as Record<string, unknown>;
  const type = typeof meta.type === "string" ? meta.type : null;
  return type && (ACCEPTED_MIME_TYPES as readonly string[]).includes(type)
    ? (type as AcceptedMimeType)
    : null;
}

export interface PreparedDocRun {
  run: DocumentRunContext;
  bytes: Uint8Array;
  mediaType: AcceptedMimeType;
  /** Epoch ms of the CAS claim — the process.done duration baseline. */
  startedAt: number;
}

export type ClaimAndPrepareResult =
  | { ok: true; prepared: PreparedDocRun }
  /** Maps to the route's statuses: 422 / 409 / 410. */
  | { ok: false; reason: "no_media_type" | "not_claimable" | "missing_bytes" };

/** The minimal fail context when the full run context was never built. */
export function minimalDocRunFailContext(
  run: DocumentRunContext,
  startedAt: number,
): DocRunToolContext {
  return {
    writer: noopDocRunWriter,
    run,
    policy: run.policy,
    allowedTypes: new Set(),
    vendorContext: { legalName: run.vendor.legalName },
    thresholds: toThresholds(run.profile),
    terminalWritten: false,
    startedAt,
  };
}

/**
 * CAS claim (PENDING|UPLOADED|FAILED|ERROR → PROCESSING) + storage byte
 * verification — the fetch IS the verification, and the fetched bytes are
 * exactly what onSession stages into the sandbox (no second fetch). Missing
 * bytes are terminal (the row flips FAILED here).
 */
export async function claimAndPrepareVendorDocRun(
  run: DocumentRunContext,
): Promise<ClaimAndPrepareResult> {
  const documentUuid = run.document.uuid;

  const mediaType = mediaTypeOf(run);
  if (!mediaType) {
    return { ok: false, reason: "no_media_type" };
  }

  const claimed = await casToProcessing(documentUuid);
  if (!claimed) {
    return { ok: false, reason: "not_claimable" };
  }

  // Run claimed → the pipeline is live. `prior=FAILED` = a "Try again" loop.
  const startedAt = Date.now();
  vendraLog("process.start", {
    doc: documentUuid,
    vendor: run.vendor.id,
    org: run.document.organizationId,
    file: fileNameOf(run),
    mediaType,
    prior: run.document.uploadStatus,
  });

  let bytes: Uint8Array;
  try {
    bytes = await readDocumentBytes(run.document.fileKey);
  } catch (err) {
    vendraError("process.bytes_missing", {
      doc: documentUuid,
      vendor: run.vendor.id,
      error: err instanceof Error ? err.message : String(err),
    });
    await failVendorDocumentInternal(
      minimalDocRunFailContext(run, startedAt),
      "No se pudo leer el archivo subido.",
    );
    return { ok: false, reason: "missing_bytes" };
  }

  // Bytes verified: the upload is real — write the audit trail.
  const claimMeta = (run.document.fileMetadata ?? {}) as Record<string, unknown>;
  await insertActivity({
    vendorId: run.vendor.id,
    organizationId: run.document.organizationId,
    type: "DOCUMENT_UPLOADED",
    documentId: run.document.id,
    metadata: {
      batchId: claimMeta.batchId,
      fileId: claimMeta.fileId,
      documentUuid,
      fileKey: run.document.fileKey,
    },
  });

  return { ok: true, prepared: { run, bytes, mediaType, startedAt } };
}

/** Assemble the tool context for one claimed run. */
export function buildVendorDocRunContext(
  prepared: PreparedDocRun,
  writer?: UIMessageStreamWriter<VendorDocUIMessage>,
): DocRunToolContext {
  const { run, startedAt } = prepared;
  const profile = toRequirementProfile(run.profile);
  const workProfile = toWorkProfile(run.vendor.workProfile);
  // SPEC §19.6: the company policy is an UPPER BOUND and the vendor's profile
  // still scopes it, so the default policy reproduces the pre-governance set
  // exactly while a narrowed policy can restrict it further.
  const profileDerived = deriveAllowedDocumentTypes(
    profile.required,
  ) as ReadonlySet<VendorDocumentType>;
  return {
    writer: writer ?? noopDocRunWriter,
    run,
    policy: run.policy,
    allowedTypes: run.policy
      ? (effectiveAllowedDocumentTypes(
          run.policy,
          profileDerived,
        ) as ReadonlySet<VendorDocumentType>)
      : profileDerived,
    vendorContext: {
      legalName: run.vendor.legalName,
      dbaName: run.vendor.dbaName,
      tinLast4: run.vendor.tinLast4,
      workStates: workProfile.states ?? [],
      buyingOrgName: run.organization.name,
    },
    thresholds: toThresholds(run.profile),
    terminalWritten: false,
    startedAt,
  };
}

/**
 * A run attempt may be recovered (re-run on a fresh session) only while it
 * is side-effect-free toward the vendor: no terminal written, no HITL window
 * opened or settled, and the run budget not exhausted.
 */
function canRecoverDocRun(ctx: DocRunToolContext, signal: AbortSignal): boolean {
  return (
    !ctx.terminalWritten &&
    !signal.aborted &&
    (ctx.pendingConfirmations?.size ?? 0) === 0 &&
    (ctx.confirmationOutcomes?.size ?? 0) === 0
  );
}

/** Clear the agent-decided state so a recovery attempt starts clean. */
function resetDocRunAttempt(ctx: DocRunToolContext): void {
  ctx.classification = undefined;
  ctx.extractedData = undefined;
}

/**
 * The semaphore-gated harness run for one claimed document, with transient
 * recovery. Owns per-attempt session teardown and slot release in its
 * finally — when this settles the caller may kick the coverage determination
 * without double-holding a slot. Throws what the agent throws (after
 * teardown).
 */
export async function executeClaimedVendorDocRun(
  ctx: DocRunToolContext,
  prepared: PreparedDocRun,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const documentUuid = prepared.run.document.uuid;
  const signal = opts.signal ?? AbortSignal.timeout(DOC_RUN_TIMEOUT_MS);

  writeStage(ctx, "PENDING");

  // Frameless window #1: the queue wait.
  const queuedAt = Date.now();
  let releaseSlot: () => void;
  try {
    releaseSlot = await getHarnessSemaphore().acquire(signal);
  } catch (err) {
    vendraError("process.queue_abort", {
      doc: documentUuid,
      vendor: prepared.run.vendor.id,
      waitedMs: Date.now() - queuedAt,
      cause: "queue_timeout",
    });
    throw err;
  }
  const queueWaitMs = Date.now() - queuedAt;
  if (queueWaitMs > QUEUE_WAIT_LOG_MS) {
    vendraWarn("process.queue_waited", { doc: documentUuid, ms: queueWaitMs });
  }

  try {
    for (let attempt = 1; attempt <= DOC_RUN_MAX_ATTEMPTS; attempt++) {
      try {
        await runDocSessionOnce(ctx, prepared, signal, attempt);
      } catch (err) {
        if (
          attempt < DOC_RUN_MAX_ATTEMPTS &&
          canRecoverDocRun(ctx, signal) &&
          classifyHarnessError(err, signal) !== "timeout"
        ) {
          vendraWarn("process.recover", {
            doc: documentUuid,
            attempt,
            cause: classifyHarnessError(err, signal),
            ...harnessErrorFields(err),
          });
          resetDocRunAttempt(ctx);
          continue;
        }
        throw err;
      }

      if (ctx.terminalWritten) return;

      // Stream ended cleanly but the agent never reached a terminal —
      // recoverable: a fresh session usually completes.
      if (attempt < DOC_RUN_MAX_ATTEMPTS && canRecoverDocRun(ctx, signal)) {
        vendraWarn("process.recover", {
          doc: documentUuid,
          attempt,
          cause: "no_terminal",
        });
        resetDocRunAttempt(ctx);
        continue;
      }
      vendraWarn("process.no_terminal", { doc: documentUuid, attempt });
      await failVendorDocumentInternal(ctx, "El procesamiento terminó inesperadamente.");
      return;
    }
  } finally {
    releaseSlot();
  }
}

/**
 * One harness session attempt: sandbox session (with the fresh-sandbox
 * createSession retry) → original bytes installed → agent stream → drain.
 * Owns THIS attempt's session teardown in its finally.
 */
async function runDocSessionOnce(
  ctx: DocRunToolContext,
  prepared: PreparedDocRun,
  signal: AbortSignal,
  attempt: number,
): Promise<void> {
  const { run, bytes, mediaType } = prepared;
  const documentUuid = run.document.uuid;

  let session:
    | Awaited<ReturnType<InstanceType<typeof HarnessAgent>["createSession"]>>
    | undefined;

  try {
    writeStage(ctx, "PROCESSING", "reading");

    // The ORIGINAL bytes go into the sandbox unchanged — the in-sandbox
    // Claude Code `read` tool handles PDFs and images natively. No host-side
    // rasterization — a deliberate invariant, not an omission.
    const docFileName = `document${EXTENSION_BY_MIME[mediaType]}`;
    let docPath: string | undefined;

    // Factory (not a bare construction) so the forceFresh retry can REBUILD
    // the agent on a fresh provider.
    const makeAgent = (
      sandbox: Awaited<ReturnType<typeof getSharedSandboxProvider>>,
    ) =>
      new HarnessAgent({
        harness: createClaudeCode({
          model: env.HARNESS_MODEL,
          // Doc lane: adaptive thinking (the coverage lane runs DISABLED —
          // the measured rationale lives in coverage-runner.ts).
          thinking: { type: "adaptive", display: "summarized" },
          // Headroom for the chunked HITL wait: an unanswered confirmation
          // costs one finalizeDocument re-call per 30s chunk — two full
          // windows on top of the ~6-10 turns a normal run takes.
          maxTurns:
            28 +
            2 *
              Math.ceil(
                (env.VENDOR_CONFIRMATION_WINDOW_MS ?? CONFIRMATION_WINDOW_MS) /
                  30_000,
              ),
          startupTimeoutMs: 180_000,
          // Pin direct Anthropic auth — ambient env fallbacks (gateway/OIDC)
          // must never engage.
          auth: { anthropic: { apiKey: env.ANTHROPIC_API_KEY } },
        }),
        sandbox,
        tools: buildVendorDocTools(ctx),
        activeTools: [
          "read",
          "saveClassification",
          "saveExtraction",
          "finalizeDocument",
          "failDocument",
        ],
        // Defense-in-depth: `read` is the only active built-in.
        permissionMode: "allow-reads",
        telemetry: { integrations: [getHarnessFileReporter()] },
        sandboxConfig: {
          onSession: async ({ session: sboxSession, sessionWorkDir }) => {
            docPath = `${sessionWorkDir}/incoming/${docFileName}`;
            await sboxSession.writeBinaryFile({
              path: docPath,
              content: bytes,
            });
          },
        },
      });

    // One retry on a fresh sandbox — the shared one may have hit its
    // 45-minute lifetime underneath us.
    const sessionStartedAt = Date.now();
    let agent = makeAgent(await getSharedSandboxProvider());
    try {
      session = await agent.createSession({ abortSignal: signal });
    } catch (err) {
      vendraWarn("process.retry", {
        doc: documentUuid,
        attempt,
        reason: "createSession failed; retrying on a fresh sandbox",
        ...harnessErrorFields(err),
      });
      agent = makeAgent(await getSharedSandboxProvider({ forceFresh: true }));
      session = await agent.createSession({ abortSignal: signal });
    }
    // Frameless window #2: the session boot.
    vendraLog("process.session_ready", {
      doc: documentUuid,
      attempt,
      ms: Date.now() - sessionStartedAt,
    });

    writeStage(ctx, "PROCESSING", "analyzing");
    if (!docPath) {
      throw new Error(
        "sandbox session ready but the document file was not installed",
      );
    }
    const result = await agent.stream({
      session,
      prompt: buildDocPrompt({
        docPath,
        allowedTypes: ctx.allowedTypes,
        vendorLegalName: ctx.vendorContext.legalName,
        fileName: fileNameOf(run),
      }),
      abortSignal: signal,
    });
    ctx.writer.merge(
      toUIMessageStream({ stream: result.stream, sendReasoning: true }),
    );
    await result.text;
  } finally {
    try {
      await session?.destroy(); // the session only — the shared sandbox survives
    } catch (err) {
      vendraError("process.teardown", {
        doc: documentUuid,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
