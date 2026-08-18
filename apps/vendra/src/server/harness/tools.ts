/**
 * Host-executed tools for the document-processing harness run (SPEC §6.2).
 *
 * The agent (Claude Code, in the sandbox) decides ONLY classification and
 * extracted values. Everything downstream of saveExtraction — HITL gates,
 * validation, requirement verification, CAS terminal writes, cross-document
 * recompute — runs HERE, in the Next.js process, on the pure
 * @vendra/workflow modules. The model never decides compliance.
 */
import { tool, type UIMessageStreamWriter } from "ai";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import {
  SchemaRegistry,
  VendorDocumentTypeEnum,
  compareEntityNames,
  deriveExtractedExpirationDate,
  deriveTinLast4,
  deriveVendorEntityName,
  enforceMaskedFields,
  evaluateCoverageScopedGrant,
  failedValidationMessages,
  isInsuranceDocumentType,
  validateVendorDocument,
  vendorDocumentTypeTitle,
  verifyRequirements,
  type RequirementThresholds,
  type VendorContext,
  type VendorDocumentType,
} from "@vendra/workflow/vendor";

import { env } from "@/env";
import type {
  ConfirmationKind,
  ProcessingStage,
  SaveClassificationInput,
  VendorDocConfirmationPart,
  VendorDocTerminalPart,
  VendorDocUIMessage,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";
import {
  failDocumentInputSchema,
  finalizeDocumentInputSchema,
  saveClassificationInputSchema,
  saveExtractionInputSchema,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { recomputeCrossDocumentRequirementsForVendor } from "@/server/recompute";

import type { ConfirmationOutcome, CreatedConfirmation } from "./confirmations";
import { createConfirmation } from "./confirmations";
import type { DocumentRunContext } from "./db/documents";
import {
  casFailed,
  casProcessed,
  insertActivity,
  recordAdditionalEntityNames,
} from "./db/documents";
import {
  insertExtractionVersion,
  updateLatestExtractionRequirements,
  writeValidationToLatestExtraction,
} from "./db/extraction-version";
import { vendraError, vendraLog, vendraWarn } from "./log";

/** UNKNOWN early-exit copy. */
export const UNRECOGNIZED_DOCUMENT_REASON =
  "We could not recognize this document type. Please upload one of the accepted document types listed on the right.";

/** Production lesson: name what was read when the profile doesn't accept it. */
export function notAcceptedDocumentReason(documentType: string): string {
  return `We read this document as "${vendorDocumentTypeTitle(documentType)}", but this compliance profile does not require that document type. Please upload one of the accepted document types listed on the right.`;
}

/** Accept an object as-is; parse a JSON-encoded object string; else null. */
function coerceRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export interface DocRunToolContext {
  writer: UIMessageStreamWriter<VendorDocUIMessage>;
  run: DocumentRunContext;
  allowedTypes: ReadonlySet<VendorDocumentType>;
  vendorContext: VendorContext;
  thresholds: RequirementThresholds;
  classification?: SaveClassificationInput;
  extractedData?: Record<string, unknown>;
  /** HITL windows opened by finalizeDocument, keyed by kind — the chunked
   *  wait resumes the SAME window across the agent's re-calls. */
  pendingConfirmations?: Map<ConfirmationKind, CreatedConfirmation>;
  /** Settled HITL outcomes, keyed by kind — a re-call re-enters from the top,
   *  so an earlier gate must replay its outcome, never open a fresh window. */
  confirmationOutcomes?: Map<ConfirmationKind, ConfirmationOutcome>;
  terminalWritten: boolean;
  /**
   * Set when the run settles (return or throw) — distinguishes a run that
   * truly ended from a response stream that closed early while the run
   * continues detached. The route's failsafe keys on THIS, never on
   * stream close.
   */
  runSettled?: boolean;
  /** Epoch ms when the run was claimed — for the process.done duration log. */
  startedAt?: number;
  /** Guards the process.error log so a re-surfaced error logs once. */
  errorLogged?: boolean;
}

export function writeStage(
  ctx: DocRunToolContext,
  status: "PENDING" | "PROCESSING",
  stage?: ProcessingStage,
): void {
  ctx.writer.write({
    type: "data-vendor-doc-stage",
    id: `stage-${ctx.run.document.uuid}`,
    data: { status, ...(stage ? { stage } : {}) },
  });
}

function writeTerminal(ctx: DocRunToolContext, data: VendorDocTerminalPart): void {
  if (ctx.terminalWritten) return;
  ctx.terminalWritten = true;
  vendraLog("process.done", {
    doc: ctx.run.document.uuid,
    vendor: ctx.run.vendor.id,
    outcome: data.status,
    type: data.documentType ?? undefined,
    granted: data.requirementsGranted.length,
    ...(data.status === "COMPLETED" && data.requirementsGranted.length > 0
      ? { categories: data.requirementsGranted.join(",") }
      : {}),
    ...(data.status === "FAILED" ? { reason: data.reason } : {}),
    ...(ctx.startedAt ? { ms: Date.now() - ctx.startedAt } : {}),
  });
  ctx.writer.write({
    type: "data-vendor-doc-terminal",
    id: `terminal-${ctx.run.document.uuid}`,
    data,
  });
}

function documentRejectedMetadata(ctx: DocRunToolContext, reason: string) {
  const meta = (ctx.run.document.fileMetadata ?? {}) as Record<string, unknown>;
  return {
    batchId: meta.batchId,
    fileId: meta.fileId,
    documentUuid: ctx.run.document.uuid,
    fileKey: ctx.run.document.fileKey,
    failureReason: reason,
  };
}

/**
 * Shared fail path — CAS PROCESSING→FAILED (never inverts PROCESSED) +
 * DOCUMENT_REJECTED activity + terminal part. Idempotent; also the route's
 * run-settle safety net.
 */
export async function failVendorDocumentInternal(
  ctx: DocRunToolContext,
  reason: string,
  failedValidations?: string[],
  scopedCategories?: string[],
): Promise<void> {
  if (ctx.terminalWritten) return;
  const flipped = await casFailed(ctx.run.document.uuid, reason);
  if (flipped) {
    await insertActivity({
      vendorId: ctx.run.vendor.id,
      organizationId: ctx.run.document.organizationId,
      type: "DOCUMENT_REJECTED",
      documentId: ctx.run.document.id,
      metadata: documentRejectedMetadata(ctx, reason),
    });
  }
  writeTerminal(ctx, {
    status: "FAILED",
    documentType: ctx.classification?.documentType ?? null,
    documentSubtype: ctx.classification?.documentSubtype ?? null,
    requirementsGranted: [],
    reason,
    ...(failedValidations && failedValidations.length > 0
      ? { failedValidations }
      : {}),
    ...(scopedCategories && scopedCategories.length > 0
      ? { scopedCategories }
      : {}),
  });
}

/**
 * How long one finalizeDocument call may block on a pending confirmation
 * before handing control back to the agent. The bridge WebSocket carries NO
 * traffic while a host tool blocks — an idle proxy/watchdog kills it well
 * before the 5-minute window; chunking keeps the bridge alive (each re-call
 * IS traffic).
 */
const CONFIRMATION_CHUNK_MS = 30_000;

async function raceOutcomeChunk(
  outcome: Promise<ConfirmationOutcome>,
  ms: number,
): Promise<ConfirmationOutcome | "pending"> {
  let timer: NodeJS.Timeout | undefined;
  const chunk = new Promise<"pending">((resolve) => {
    timer = setTimeout(() => resolve("pending"), ms);
    timer.unref();
  });
  try {
    return await Promise.race([outcome, chunk]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Emit the HITL confirmation part (once, on the call that opens the window),
 * await the vendor's answer for up to one chunk, then either settle the part
 * (same stable id) or report "pending" so finalizeDocument bounces control
 * back to the agent and resumes this SAME window on the re-call.
 */
async function awaitVendorConfirmationChunk(
  ctx: DocRunToolContext,
  kind: ConfirmationKind,
  entityName: string | null,
): Promise<ConfirmationOutcome | "pending"> {
  const settled = ctx.confirmationOutcomes?.get(kind);
  if (settled) return settled;

  // Part id keyed by KIND so chained windows stream independent parts.
  const partId = `confirmation-${ctx.run.document.uuid}-${kind}`;
  let created = ctx.pendingConfirmations?.get(kind);
  if (!created) {
    created = await createConfirmation({
      documentId: ctx.run.document.id,
      documentUuid: ctx.run.document.uuid,
      kind,
      entityName,
    });
    ctx.pendingConfirmations ??= new Map();
    ctx.pendingConfirmations.set(kind, created);
    // NEVER log entityName (a business identity tied to this vendor).
    vendraLog("process.hitl_opened", {
      doc: ctx.run.document.uuid,
      vendor: ctx.run.vendor.id,
      kind,
      expiresAt: created.expiresAt,
    });
    writeStage(ctx, "PROCESSING", "validating");
    ctx.writer.write({
      type: "data-vendor-doc-confirmation",
      id: partId,
      data: {
        confirmationUuid: created.confirmationUuid,
        kind,
        question: created.question,
        ...(entityName ? { entityName } : {}),
        expiresAt: created.expiresAt,
      } satisfies VendorDocConfirmationPart,
    });
  }
  const result = await raceOutcomeChunk(created.outcome, CONFIRMATION_CHUNK_MS);
  if (result === "pending") return "pending";
  ctx.pendingConfirmations?.delete(kind);
  ctx.confirmationOutcomes ??= new Map();
  ctx.confirmationOutcomes.set(kind, result);
  vendraLog("process.hitl_settled", {
    doc: ctx.run.document.uuid,
    kind,
    outcome: result,
    ...(ctx.startedAt ? { ms: Date.now() - ctx.startedAt } : {}),
  });
  ctx.writer.write({
    type: "data-vendor-doc-confirmation",
    id: partId,
    data: {
      confirmationUuid: created.confirmationUuid,
      kind,
      question: created.question,
      ...(entityName ? { entityName } : {}),
      expiresAt: created.expiresAt,
      settled: true,
    },
  });
  return result;
}

const CONFIRMATION_PENDING_INSTRUCTION =
  "The vendor's confirmation window is still open. Call finalizeDocument again immediately to keep waiting — do not call any other tool.";

/** Build the four host tools bound to one document run. */
export function buildVendorDocTools(ctx: DocRunToolContext) {
  const saveClassification = tool({
    description:
      "Record the document's classification. Call exactly once, after reading every page. Returns extraction instructions for the classified type (or ends the run for unusable documents).",
    inputSchema: saveClassificationInputSchema,
    execute: async (input) => {
      writeStage(ctx, "PROCESSING", "classifying");

      // Defensive re-canonicalization: the SDK can surface a tool-input-error
      // yet still execute with the RAW input — normalize again so a
      // naming-only mismatch never reads as UNKNOWN.
      const rawType = input.documentType as string;
      const upper = rawType.trim().toUpperCase();
      const keyMapped = (VendorDocumentTypeEnum as Record<string, string>)[upper];
      const type = (keyMapped ?? upper) as VendorDocumentType;
      ctx.classification = { ...input, documentType: type };

      vendraLog("process.classified", {
        doc: ctx.run.document.uuid,
        type,
        subtype: input.documentSubtype ?? undefined,
        confidence: input.confidence,
        ...(type !== rawType ? { canonicalized_from: rawType } : {}),
        extra_entities: input.additionalEntityNames?.length ?? 0,
      });

      if (type === VendorDocumentTypeEnum.UNKNOWN || !ctx.allowedTypes.has(type)) {
        const cause =
          type === VendorDocumentTypeEnum.UNKNOWN ? "unknown_type" : "not_in_catalog";
        vendraWarn("process.unrecognized", {
          doc: ctx.run.document.uuid,
          type,
          cause,
        });
        // Early-exit: FAILED, NO extraction row — with distinct copy per
        // cause ("could not recognize" is a lie for a type we classified
        // but the profile doesn't accept).
        await failVendorDocumentInternal(
          ctx,
          cause === "unknown_type"
            ? UNRECOGNIZED_DOCUMENT_REASON
            : notAcceptedDocumentReason(type),
        );
        return {
          finished: true,
          instruction:
            "Classification could not be used. Reply 'done' and stop — do not call any other tool.",
        };
      }

      // Advisory multi-entity record — never blocks. Always written (even
      // empty) so a re-run clears a stale warning.
      await recordAdditionalEntityNames(
        ctx.run.document.uuid,
        input.additionalEntityNames ?? [],
      );

      writeStage(ctx, "PROCESSING", "extracting");
      return {
        finished: false,
        extraction: {
          systemPrompt: SchemaRegistry.getSystemPrompt(type),
          jsonSchema: SchemaRegistry.getJsonSchema(type),
        },
        instruction:
          "Extract per systemPrompt + jsonSchema, then call saveExtraction exactly once.",
      };
    },
  });

  const saveExtraction = tool({
    description:
      "Persist the extracted field data for the classified document. Call exactly once, after saveClassification.",
    inputSchema: saveExtractionInputSchema,
    execute: async (input) => {
      if (!ctx.classification) {
        return { error: "Call saveClassification before saveExtraction." };
      }

      // Tolerant coercion: the model sometimes sends extractedData as a
      // JSON-encoded STRING; a string reaching the validators reads every
      // field as undefined — coerce here, bounce unparseable input back.
      const extractedData = coerceRecord(input.extractedData);
      if (extractedData === null) {
        return {
          error:
            "extractedData must be a JSON OBJECT (not a string). Call saveExtraction again with the extracted fields as a plain object.",
        };
      }
      writeStage(ctx, "PROCESSING", "saving");

      // PII defense in depth: enforce last-4 masks at persist time (§10).
      enforceMaskedFields(extractedData);

      // Non-blocking schema check — log-only, field PATHS only (zod issue
      // messages can echo received values).
      const parsed = SchemaRegistry.getSchema(
        ctx.classification.documentType,
      ).safeParse(extractedData);
      if (!parsed.success) {
        vendraWarn("process.extraction_shape", {
          doc: ctx.run.document.uuid,
          issues: parsed.error.issues.length,
          paths: parsed.error.issues
            .slice(0, 5)
            .map((i) => i.path.join("."))
            .join(","),
        });
      }

      const rawConfidences = coerceRecord(input.fieldConfidences);
      const version = await insertExtractionVersion({
        documentId: ctx.run.document.id,
        documentType: ctx.classification.documentType,
        documentSubtype: ctx.classification.documentSubtype ?? null,
        classificationConfidence: ctx.classification.confidence,
        classificationReasoning: ctx.classification.reasoning,
        extractedData,
        fieldConfidences: rawConfidences,
        model: env.HARNESS_MODEL,
      });
      ctx.extractedData = extractedData;

      // Field COUNT only, never keys-with-values. `coerced` marks the
      // model-sent-a-JSON-string drift.
      vendraLog("process.extracted", {
        doc: ctx.run.document.uuid,
        type: ctx.classification.documentType,
        version,
        fields: Object.keys(extractedData).length,
        coerced: typeof input.extractedData === "string",
        ...(ctx.startedAt ? { ms: Date.now() - ctx.startedAt } : {}),
      });

      // The canonical extraction part: exactly what was just persisted.
      let fieldConfidences: Record<string, number> | undefined;
      if (rawConfidences) {
        fieldConfidences = {};
        for (const [key, value] of Object.entries(rawConfidences)) {
          if (typeof value === "number") fieldConfidences[key] = value;
        }
      }
      ctx.writer.write({
        type: "data-vendor-doc-extraction",
        id: `extraction-${ctx.run.document.uuid}`,
        data: {
          extractedData,
          ...(fieldConfidences ? { fieldConfidences } : {}),
        },
      });

      return {
        saved: true,
        version,
        instruction: "Now call finalizeDocument exactly once.",
      };
    },
  });

  const finalizeDocument = tool({
    description:
      "Hand the document to the host for validation, requirement verification, and completion. Call after saveExtraction. If the result says a vendor confirmation is still pending, call this tool again immediately; otherwise call it only once.",
    inputSchema: finalizeDocumentInputSchema,
    execute: async () => {
      const classification = ctx.classification;
      const extractedData = ctx.extractedData;
      if (!classification || extractedData === undefined) {
        return {
          error: "Call saveClassification and saveExtraction before finalizeDocument.",
        };
      }
      const docType = classification.documentType;

      // ── HITL gate 1: entity-identity confirmation (BEFORE validation).
      const entityName = deriveVendorEntityName(docType, extractedData);
      if (entityName && !ctx.vendorContext.entityConfirmed) {
        const comparison = compareEntityNames(entityName, {
          legalName: ctx.vendorContext.legalName,
          dbaName: ctx.vendorContext.dbaName ?? null,
        });
        const kind: ConfirmationKind | null =
          comparison.confidence === "ambiguous"
            ? "DBA_SAME_ENTITY"
            : comparison.confidence === "noMatch" && isInsuranceDocumentType(docType)
              ? "PARENT_POLICY_COVERS_SUBSIDIARY"
              : null;
        if (kind) {
          const outcome = await awaitVendorConfirmationChunk(ctx, kind, entityName);
          if (ctx.terminalWritten) {
            // The run died while this continuation was parked (the route's
            // safety net already FAILED the doc) — never mutate as a zombie.
            return { finished: true };
          }
          if (outcome === "pending") {
            return { finished: false, instruction: CONFIRMATION_PENDING_INSTRUCTION };
          }
          if (outcome === "confirmed") {
            ctx.vendorContext = { ...ctx.vendorContext, entityConfirmed: true };
          } else if (outcome === "denied") {
            const reason = `You confirmed "${entityName}" is not your business, so this document cannot count toward your compliance.`;
            await failVendorDocumentInternal(ctx, reason, [reason]);
            return { finished: true };
          }
          // timeout → FAIL OPEN (continue unconfirmed): validation decides,
          // and a name-mismatch-only insurance failure still counts at
          // coverage scope below.
        }
      }

      // ── HITL gate 2: blanket additional-insured endorsement (COI only).
      if (
        docType === VendorDocumentTypeEnum.ACORD_25_COI &&
        ctx.thresholds.requireAdditionalInsured &&
        extractedData.additional_insured === null &&
        !ctx.vendorContext.blanketEndorsementConfirmed &&
        !ctx.vendorContext.blanketEndorsementDenied
      ) {
        const outcome = await awaitVendorConfirmationChunk(
          ctx,
          "BLANKET_ENDORSEMENT_APPLIES",
          null,
        );
        if (ctx.terminalWritten) return { finished: true };
        if (outcome === "pending") {
          return { finished: false, instruction: CONFIRMATION_PENDING_INSTRUCTION };
        }
        if (outcome === "confirmed") {
          ctx.vendorContext = {
            ...ctx.vendorContext,
            blanketEndorsementConfirmed: true,
          };
        } else if (outcome === "denied") {
          ctx.vendorContext = {
            ...ctx.vendorContext,
            blanketEndorsementDenied: true,
          };
        }
        // timeout → fail-open: the endorsement rule stays informational.
      }

      // ── Validation (host-run, pure validators).
      writeStage(ctx, "PROCESSING", "validating");
      const validation = validateVendorDocument(
        docType,
        extractedData,
        ctx.vendorContext,
        { thresholds: ctx.thresholds },
      );
      await writeValidationToLatestExtraction(
        ctx.run.document.id,
        validation?.rules ?? [],
        validation?.valid ?? false,
      );
      // Stable rule ids only — the human copy interpolates entity names.
      const allRules = validation?.rules ?? [];
      const failedRules = allRules.filter((r) => !r.passed && !r.informational);
      vendraLog("process.validated", {
        doc: ctx.run.document.uuid,
        type: docType,
        valid: validation?.valid ?? false,
        rules: allRules.length,
        failed: failedRules.length,
        ...(failedRules.length > 0
          ? { failedRules: failedRules.map((r) => r.rule).join(",") }
          : {}),
        ...(ctx.startedAt ? { ms: Date.now() - ctx.startedAt } : {}),
      });
      ctx.writer.write({
        type: "data-vendor-doc-validation",
        id: `validation-${ctx.run.document.uuid}`,
        data: { valid: validation?.valid ?? false, rules: allRules },
      });

      if (!(validation?.valid ?? false)) {
        const failedValidations = failedValidationMessages(allRules);
        // Coverage-scoped salvage: a name-mismatch-only
        // insurance failure still FAILS the row, but its evidence counts at
        // coverage scope — the terminal carries the categories so the client
        // renders "Counted · coverage" instead of an error.
        const scoped = evaluateCoverageScopedGrant({
          documentType: docType,
          extractedData,
          validationResult: validation,
        });
        if (scoped.isCoverageAccepted) {
          vendraLog("process.coverage_scoped", {
            doc: ctx.run.document.uuid,
            type: docType,
            categories: scoped.coverageCategories.join(","),
          });
          await updateLatestExtractionRequirements(
            ctx.run.document.id,
            [],
            scoped.coverageCategories,
          );
        }
        await failVendorDocumentInternal(
          ctx,
          failedValidations[0] ?? "Document validation failed.",
          failedValidations,
          scoped.isCoverageAccepted ? scoped.coverageCategories : undefined,
        );
        return { finished: true };
      }

      // ── Requirement verification (host-run).
      writeStage(ctx, "PROCESSING", "mapping");
      const requirements = verifyRequirements(docType, extractedData, validation);

      // ── Terminal commit: CAS PROCESSING→PROCESSED (+ uploadType + the
      //    sweep's expiration index), then requirements onto the extraction.
      writeStage(ctx, "PROCESSING", "finalizing");
      const uploadType = classification.documentSubtype
        ? `${docType}:${classification.documentSubtype}`
        : docType;
      const expirationDate = deriveExtractedExpirationDate(docType, extractedData);
      const committed = await casProcessed(
        ctx.run.document.uuid,
        uploadType,
        expirationDate,
      );
      if (!committed) {
        // Already terminal (concurrent failure/cancel) — publish nothing and
        // suppress the safety net; without this the run reads like a crash.
        vendraWarn("process.superseded", {
          doc: ctx.run.document.uuid,
          vendor: ctx.run.vendor.id,
        });
        ctx.terminalWritten = true;
        return { finished: true };
      }
      await updateLatestExtractionRequirements(
        ctx.run.document.id,
        requirements.satisfiedCategories,
        [],
      );
      await insertActivity({
        vendorId: ctx.run.vendor.id,
        organizationId: ctx.run.document.organizationId,
        type: "DOCUMENT_VERIFIED",
        documentId: ctx.run.document.id,
        metadata: {
          documentUuid: ctx.run.document.uuid,
          documentType: docType,
          requirementsGranted: requirements.satisfiedCategories,
        },
      });

      // TIN linkage: a verified W-9/W-8 backfills the vendor's tin_last4.
      const tinLast4 = deriveTinLast4(docType, extractedData);
      if (tinLast4 && !ctx.run.vendor.tinLast4) {
        await getDb()
          .update(schema.vendor)
          .set({ tinLast4 })
          .where(eq(schema.vendor.id, ctx.run.vendor.id));
      }

      // ── Cross-document recompute — best-effort in-line; the coverage-lane
      //    kick is deliberately deferred to the route's run-settle finally
      //    (after the semaphore slot is released, §6.3).
      const recomputeStartedAt = Date.now();
      try {
        const cross = await recomputeCrossDocumentRequirementsForVendor(
          ctx.run.vendor.id,
        );
        vendraLog("process.recompute", {
          doc: ctx.run.document.uuid,
          vendor: ctx.run.vendor.id,
          crossGranted: cross.grantedCategories.length,
          ms: Date.now() - recomputeStartedAt,
        });
      } catch (err) {
        // Best-effort after the terminal commit — a failure must not invert
        // the PROCESSED document.
        vendraError("process.recompute_failed", {
          doc: ctx.run.document.uuid,
          vendor: ctx.run.vendor.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      writeTerminal(ctx, {
        status: "COMPLETED",
        documentType: docType,
        documentSubtype: classification.documentSubtype ?? null,
        validUploadType: uploadType,
        requirementsGranted: requirements.satisfiedCategories,
      });
      return {
        finished: true,
        summary: {
          documentType: docType,
          validUploadType: uploadType,
          requirementsGranted: requirements.satisfiedCategories,
        },
      };
    },
  });

  const failDocument = tool({
    description:
      "Mark the document as failed when it is unreadable, blank, or corrupt. Call instead of the other tools.",
    inputSchema: failDocumentInputSchema,
    execute: async (input) => {
      await failVendorDocumentInternal(ctx, input.reason);
      return { finished: true };
    },
  });

  return { saveClassification, saveExtraction, finalizeDocument, failDocument };
}
