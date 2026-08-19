/**
 * The coverage-determination lane (SPEC §6.6) — one detached,
 * authoritative harness session per vendor resolves aggregate effective
 * coverage (primary + umbrella stacking). Battle-tested discipline:
 *
 * - Fire-and-forget: `runCoverageDetermination` never throws to its caller.
 * - Per-vendor coalescing with a `rerun` flag — a kick landing mid-run marks
 *   rerun instead of stacking sessions.
 * - Signature cache: an input-set hash short-circuits identical reruns; the
 *   signature carries an explicit version axis (the policy-purge lever).
 * - `thinking: { type: "disabled" }` — a spec-level requirement, learned in
 *   production: adaptive thinking spiraled this exact lane to ~470s/attempt;
 *   disabling took it to ~27s. Config, not code.
 * - Up to 3 attempts, then FAIL-OPEN: persist an explicit UNDETERMINED
 *   record so readers show "undetermined", never a stale figure.
 * - Host-authoritative persist: the validator bounces bad payloads back to
 *   the agent; the persisted figures are re-derived from contributions.
 * - Dedicated 1-slot semaphore — doc runs can never starve this lane.
 */
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { tool } from "ai";
import { eq, sql } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import {
  assembleCoverageDetermination,
  requirementCategoryLabel,
  requiredOccurrenceLimit,
  validateCoverageDetermination,
  type CoverageDeterminationRecord,
  type RequirementThresholds,
  type SaveCoverageDeterminationInput,
  isInsuranceDocumentType,
  type VendorDocumentType,
} from "@vendra/workflow/vendor";

import { env } from "@/env";
import { saveCoverageDeterminationInputSchema } from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { toThresholds } from "@/server/profile";
import { recomputeBestEffort, loadVendorEvidence } from "@/server/recompute";

import {
  beginCoverageProgress,
  endCoverageProgress,
  endCoverageProgressAfter,
  publishCoverageNarration,
  publishCoverageStage,
} from "./coverage-progress";
import { vendraError, vendraLog, vendraWarn } from "./log";
import {
  classifyHarnessError,
  getCoverageSemaphore,
  getHarnessFileReporter,
  getSharedSandboxProvider,
  harnessErrorFields,
  missingHarnessCredentialNames,
} from "./sandbox";

const COVERAGE_RUN_TIMEOUT_MS = 480_000;
/** How long a no-run terminal broadcast stays attachable (> the 4s attach loop). */
const NO_RUN_BROADCAST_GRACE_MS = 10_000;
const COVERAGE_MAX_ATTEMPTS = 3;

interface CoalescedRun {
  running: boolean;
  rerun: boolean;
}

const globalStore = globalThis as typeof globalThis & {
  __vendraCoverageRuns?: Map<number, CoalescedRun>;
};

const runs: Map<number, CoalescedRun> =
  globalStore.__vendraCoverageRuns ?? (globalStore.__vendraCoverageRuns = new Map());

/**
 * Fire-and-forget entrypoint — every kick funnels here (run-settle in the
 * process route, doc delete, officer mutations, the officer kick mirror).
 */
export function runCoverageDetermination(vendorId: number): void {
  const existing = runs.get(vendorId);
  if (existing?.running) {
    // A kick landing mid-run marks rerun instead of stacking sessions.
    existing.rerun = true;
    return;
  }
  const state: CoalescedRun = { running: true, rerun: false };
  runs.set(vendorId, state);
  void (async () => {
    try {
      do {
        state.rerun = false;
        await runOnce(vendorId);
      } while (state.rerun);
    } catch (err) {
      // Never throws to callers — terminal catch-all.
      vendraError("coverage.run_crashed", {
        vendor: vendorId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      runs.delete(vendorId);
    }
  })();
}

interface DeterminationDocInput {
  documentUuid: string;
  documentType: string;
  uploadStatus: string;
  scopedCategories: string[];
  manualGrantCategories: string[];
  extractedData: Record<string, unknown>;
  confirmedKinds: string[];
}

async function runOnce(vendorId: number): Promise<void> {
  if (missingHarnessCredentialNames().length > 0) {
    vendraWarn("coverage.skipped", { vendor: vendorId, reason: "unconfigured" });
    return;
  }

  const now = new Date();
  const db = getDb();
  const loaded = await loadVendorEvidence(db, vendorId, now);

  // Signature cache: identical inputs → identical determination; skip — but
  // still broadcast a terminal stage (held open for a grace window so the
  // client's 4s attach loop can land) instead of leaving an attached
  // progress stream retrying 204s against a run that will never start.
  if (loaded.determinationFresh) {
    vendraLog("coverage.signature_hit", {
      vendor: vendorId,
      signature: loaded.signature,
    });
    beginCoverageProgress(vendorId);
    publishCoverageStage(vendorId, { stage: "converged" });
    endCoverageProgressAfter(vendorId, NO_RUN_BROADCAST_GRACE_MS);
    return;
  }

  // Assemble the lane's input set: insurance docs with an extraction, plus
  // any doc carrying an active manual grant for a coverage category
  // (an officer's grant is never invisible to the lane it feeds).
  const docRows = await db
    .select()
    .from(schema.vendorDocument)
    .where(eq(schema.vendorDocument.vendorId, vendorId))
    .orderBy(schema.vendorDocument.id);
  const inputs: DeterminationDocInput[] = [];
  for (const evidenceDoc of loaded.docs) {
    const isInsurance =
      evidenceDoc.documentType &&
      isInsuranceDocumentType(evidenceDoc.documentType as VendorDocumentType);
    const hasCoverageGrant = evidenceDoc.manualGrantCategories.length > 0;
    if (!isInsurance && !hasCoverageGrant) continue;
    if (!evidenceDoc.documentType) continue;
    const docRow = docRows.find((d) => d.uuid === evidenceDoc.documentUuid);
    if (!docRow) continue;
    const [extraction] = await db
      .select()
      .from(schema.vendorDocumentExtraction)
      .where(eq(schema.vendorDocumentExtraction.documentId, docRow.id))
      .orderBy(sql`${schema.vendorDocumentExtraction.version} DESC`)
      .limit(1);
    if (!extraction) continue;
    const confirmations = await db
      .select()
      .from(schema.documentConfirmation)
      .where(eq(schema.documentConfirmation.documentId, docRow.id));
    inputs.push({
      documentUuid: evidenceDoc.documentUuid,
      documentType: evidenceDoc.documentType,
      uploadStatus: evidenceDoc.uploadStatus,
      scopedCategories: evidenceDoc.scopedCategories,
      manualGrantCategories: evidenceDoc.manualGrantCategories,
      extractedData: (extraction.extractedData ?? {}) as Record<string, unknown>,
      confirmedKinds: confirmations
        .filter((c) => c.answer === true)
        .map((c) => c.kind),
    });
  }

  if (inputs.length === 0) {
    vendraLog("coverage.no_inputs", { vendor: vendorId });
    // Same terminal broadcast as the signature hit: nothing will run, so any
    // attached client must settle rather than poll forever.
    beginCoverageProgress(vendorId);
    publishCoverageStage(vendorId, { stage: "unavailable" });
    endCoverageProgressAfter(vendorId, NO_RUN_BROADCAST_GRACE_MS);
    return;
  }

  // Mid-drain: sibling docs still processing → one opportunistic session
  // (the next terminal re-kicks); quiescent → converge up to 3 attempts.
  const midDrain = loaded.docs.some(
    (d) => d.uploadStatus === "PROCESSING" || d.uploadStatus === "UPLOADED",
  );
  const maxAttempts = midDrain ? 1 : COVERAGE_MAX_ATTEMPTS;
  const thresholds = toThresholds(loaded.profileRow);

  beginCoverageProgress(vendorId);
  publishCoverageStage(vendorId, { stage: "queued" });
  vendraLog("coverage.determination.started", {
    vendor: vendorId,
    docs: inputs.length,
    signature: loaded.signature,
    midDrain,
  });

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const saved = await runAttempt(
        vendorId,
        inputs,
        thresholds,
        loaded.signature,
        attempt,
      );
      if (saved) {
        publishCoverageStage(vendorId, { stage: "converged", attempt });
        await recomputeBestEffort(vendorId);
        vendraLog("coverage.determination.converged", {
          vendor: vendorId,
          attempt,
          signature: loaded.signature,
        });
        return;
      }
      if (attempt < maxAttempts) {
        publishCoverageStage(vendorId, { stage: "retrying", attempt });
      }
    }
    if (midDrain) {
      publishCoverageStage(vendorId, { stage: "waiting-for-documents" });
      vendraLog("coverage.waiting_for_documents", { vendor: vendorId });
      return;
    }
    // FAIL-OPEN: persist an explicit UNDETERMINED record — readers show
    // "undetermined", never a stale figure.
    vendraWarn("coverage.gave_up", { vendor: vendorId });
    await persistDetermination(
      vendorId,
      assembleCoverageDetermination({
        payload: {
          lines: (["GENERAL_LIABILITY", "WORKERS_COMP", "AUTO"] as const).map(
            (category) => ({
              category,
              effectiveOccurrenceLimitUsd: null,
              effectiveAggregateLimitUsd: null,
              contributions: [],
              verdict: "UNDETERMINED" as const,
              reasoning: "La revisión de cobertura no pudo completarse.",
            }),
          ),
          conflicts: [],
          narrative:
            "La revisión automática de cobertura no pudo completarse — un oficial de cumplimiento puede otorgar estos requisitos manualmente.",
        },
        signature: loaded.signature,
        model: env.HARNESS_MODEL,
        now: new Date(),
      }),
    );
    await recomputeBestEffort(vendorId);
    publishCoverageStage(vendorId, { stage: "unavailable" });
  } finally {
    endCoverageProgress(vendorId);
  }
}

async function persistDetermination(
  vendorId: number,
  record: CoverageDeterminationRecord,
): Promise<void> {
  // Single jsonb sibling-merge under the vendor row, dropping legacy keys.
  await getDb()
    .update(schema.vendor)
    .set({
      complianceStatusMetadata: sql`COALESCE(${schema.vendor.complianceStatusMetadata}, '{}'::jsonb) || jsonb_build_object('coverage_determination', ${JSON.stringify(record)}::jsonb)`,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.vendor.id, vendorId));
}

function buildCoveragePrompt(
  inputs: DeterminationDocInput[],
  thresholds: RequirementThresholds,
): string {
  const requiredLines = (
    ["GENERAL_LIABILITY", "WORKERS_COMP", "AUTO"] as const
  ).map(
    (line) =>
      `- ${line}: required per-occurrence limit $${requiredOccurrenceLimit(line, thresholds).toLocaleString("en-US")} (${requirementCategoryLabel(line === "GENERAL_LIABILITY" ? "INSURANCE_GENERAL_LIABILITY" : line === "WORKERS_COMP" ? "INSURANCE_WORKERS_COMP" : "INSURANCE_AUTO")})`,
  );

  const docBlocks = inputs.map((doc) => {
    const systemDecided: string[] = [];
    if (doc.confirmedKinds.includes("PARENT_POLICY_COVERS_SUBSIDIARY")) {
      systemDecided.push(
        "SYSTEM-DECIDED: the vendor CONFIRMED this policy's insured is their parent company and its coverage extends to them — treat this document as covering the vendor; never re-judge ownership yourself.",
      );
    }
    if (doc.confirmedKinds.includes("DBA_SAME_ENTITY")) {
      systemDecided.push(
        "SYSTEM-DECIDED: the vendor CONFIRMED the name on this document is the same business (DBA) — treat it as the vendor's own; never re-judge ownership yourself.",
      );
    }
    if (doc.scopedCategories.length > 0) {
      systemDecided.push(
        `SYSTEM-DECIDED: this document FAILED validation but was accepted at coverage scope for ${doc.scopedCategories.join(", ")} — it may contribute limits there.`,
      );
    }
    if (doc.manualGrantCategories.length > 0) {
      systemDecided.push(
        `SYSTEM-DECIDED: a compliance officer manually granted ${doc.manualGrantCategories.join(", ")} on this document${doc.uploadStatus !== "PROCESSED" ? " (extraction may be unreliable — the officer's grant stands regardless)" : ""}.`,
      );
    }
    return [
      `Document ${doc.documentUuid} (type ${doc.documentType}, status ${doc.uploadStatus}):`,
      ...systemDecided.map((s) => `  ${s}`),
      `  Extraction: ${JSON.stringify(doc.extractedData)}`,
    ].join("\n");
  });

  return `You are resolving the EFFECTIVE insurance coverage for one vendor from their complete set of insurance documents. Decide, per line of business, whether the stacked coverage MEETS the required limit.

Required limits:
${requiredLines.join("\n")}

Input documents (the COMPLETE set — use ONLY these document UUIDs):
${docBlocks.join("\n\n")}

Rules:
- Primary policy limits count toward their own line.
- An UMBRELLA/EXCESS policy's limit STACKS on top of an underlying policy ONLY when the umbrella actually schedules that policy (its policy number or carrier+line appears in the umbrella's schedule of underlying policies) or explicitly follows form. An umbrella with no visible connection to the underlying policy contributes NOTHING — report it with role "rejected" and amountAppliedUsd 0, and add a conflict explaining why.
- Expired policies (expiration date in the past) contribute NOTHING — role "rejected", amountAppliedUsd 0.
- Documents marked SYSTEM-DECIDED as covering the vendor count; never re-judge entity ownership yourself.
- Workers' compensation uses the employers'-liability each-accident limit; auto uses the combined single limit.
- Only report lines for which any evidence exists among the inputs; omit lines with no evidence entirely.

Output contract — the save tool ENFORCES every rule below and bounces violations back to you:
- verdict "MEETS" requires a RESOLVED effectiveOccurrenceLimitUsd that is >= the required limit. A null effective limit is ONLY legal with verdict "UNDETERMINED".
- verdict "BELOW" requires the resolved effective limit to be < the required limit.
- Each line's effectiveOccurrenceLimitUsd MUST equal the sum of its non-rejected contributions' amountAppliedUsd (within 1%). Attribute every dollar to a document.
- Every contributions[].documentUuid MUST be one of the input document UUIDs above.
- A "rejected" contribution MUST carry amountAppliedUsd 0.

All vendor-facing prose — the per-line reasoning fields, conflicts, the narrative, and the status sentence — must be written in Latin-American Spanish (español latinoamericano, trato de usted).

Write ONE short status sentence (max ~15 words, plain second-person language) before the tool call — e.g. "Verificando si su póliza umbrella se acumula sobre su cobertura de responsabilidad civil general." Then call saveCoverageDetermination EXACTLY ONCE with your complete determination. If the tool returns an error, correct the payload and call it again.`;
}

/** One attempt: session → prompt → save tool → validate → persist. */
async function runAttempt(
  vendorId: number,
  inputs: DeterminationDocInput[],
  thresholds: RequirementThresholds,
  signature: string,
  attempt: number,
): Promise<boolean> {
  const signal = AbortSignal.timeout(COVERAGE_RUN_TIMEOUT_MS);
  const allowedUuids = new Set(inputs.map((d) => d.documentUuid));
  const startedAt = Date.now();

  const queuedAt = Date.now();
  let releaseSlot: () => void;
  try {
    releaseSlot = await getCoverageSemaphore().acquire(signal);
  } catch {
    vendraWarn("coverage.queue_abort", { vendor: vendorId, attempt });
    return false;
  }
  const queueMs = Date.now() - queuedAt;

  let saved = false;
  let toolCalls = 0;
  let session:
    | Awaited<ReturnType<InstanceType<typeof HarnessAgent>["createSession"]>>
    | undefined;

  const saveCoverageDetermination = tool({
    description:
      "Persist the vendor's coverage determination. Call exactly once with the complete per-line results; if the result is an error, correct the payload and call again.",
    inputSchema: saveCoverageDeterminationInputSchema,
    execute: async (input) => {
      toolCalls++;
      publishCoverageStage(vendorId, { stage: "checking", attempt });
      const payload = input as SaveCoverageDeterminationInput;
      const validation = validateCoverageDetermination(
        payload,
        allowedUuids,
        thresholds,
      );
      if (!validation.ok) {
        vendraWarn("coverage.payload_bounced", {
          vendor: vendorId,
          attempt,
          reason: validation.reason.slice(0, 200),
        });
        return { error: validation.reason };
      }
      publishCoverageStage(vendorId, { stage: "saving", attempt });
      const record = assembleCoverageDetermination({
        payload,
        signature,
        model: env.HARNESS_MODEL,
        now: new Date(),
      });
      await persistDetermination(vendorId, record);
      saved = true;
      return {
        saved: true,
        instruction: "Determination saved. Reply 'done' and stop.",
      };
    },
  });

  try {
    publishCoverageStage(vendorId, { stage: "starting", attempt });
    const sessionStartedAt = Date.now();
    const makeAgent = (
      sandbox: Awaited<ReturnType<typeof getSharedSandboxProvider>>,
    ) =>
      new HarnessAgent({
        harness: createClaudeCode({
          model: env.HARNESS_MODEL,
          // Thinking stays DISABLED on this lane — measured ~17× faster
          // (numbers in the header); spec-level requirement.
          thinking: { type: "disabled" },
          maxTurns: 24,
          startupTimeoutMs: 180_000,
          auth: { anthropic: { apiKey: env.ANTHROPIC_API_KEY } },
        }),
        sandbox,
        tools: { saveCoverageDetermination },
        activeTools: ["saveCoverageDetermination"],
        permissionMode: "allow-reads",
        telemetry: { integrations: [getHarnessFileReporter()] },
      });

    let agent = makeAgent(await getSharedSandboxProvider());
    try {
      session = await agent.createSession({ abortSignal: signal });
    } catch (err) {
      vendraWarn("coverage.session_retry", {
        vendor: vendorId,
        attempt,
        ...harnessErrorFields(err),
      });
      agent = makeAgent(await getSharedSandboxProvider({ forceFresh: true }));
      session = await agent.createSession({ abortSignal: signal });
    }
    const sessionMs = Date.now() - sessionStartedAt;

    publishCoverageStage(vendorId, { stage: "reviewing", attempt });
    const streamStartedAt = Date.now();
    const result = await agent.stream({
      session,
      prompt: buildCoveragePrompt(inputs, thresholds),
      abortSignal: signal,
    });
    // Drain the stream, surfacing narration text live. The protocol's
    // terminal reply (the literal "done" the save instruction asks for) is
    // a stop token, not narration — publishing it glued "…done" onto the
    // next attempt's sentence in the vendor card.
    for await (const part of result.stream) {
      if (part.type === "text-delta" && typeof part.text === "string") {
        const trimmed = part.text.trim().toLowerCase();
        if (trimmed === "done" || trimmed === "'done'" || trimmed === "done.") continue;
        publishCoverageNarration(vendorId, { text: part.text });
      }
    }
    const streamMs = Date.now() - streamStartedAt;
    vendraLog("coverage.attempt_done", {
      vendor: vendorId,
      attempt,
      queueMs,
      sessionMs,
      streamMs,
      toolCalls,
      saved,
      totalMs: Date.now() - startedAt,
    });
  } catch (err) {
    vendraError("coverage.attempt_error", {
      vendor: vendorId,
      attempt,
      cause: classifyHarnessError(err, signal),
      toolCalls,
      totalMs: Date.now() - startedAt,
      ...harnessErrorFields(err),
    });
  } finally {
    try {
      await session?.destroy();
    } catch {
      // session teardown is best-effort
    }
    releaseSlot();
  }

  // A save that landed before a late stream error still converged — the
  // record is host-validated and persisted, so the error is not load-bearing.
  return saved;
}
