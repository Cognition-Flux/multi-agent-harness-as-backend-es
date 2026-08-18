/**
 * Single client/server contract for the Vendra harness document-upload flow
 * (SPEC §6.2–§6.3).
 *
 * Both the API routes and the React client import from this module:
 * processing stages, upload constants, UI-message data-part payloads,
 * host-tool input schemas, and shared API response types. One file, so the
 * stream contract can never drift between layers.
 *
 * Imported by client components AND server code — only pure
 * `@vendra/workflow` imports (no DB, no AI, no node APIs).
 */
import type { UIMessage } from "ai";
import { z } from "zod";

import type { ValidationRule } from "@vendra/workflow/vendor";
import {
  COVERAGE_CONTRIBUTION_ROLES,
  COVERAGE_DETERMINATION_LINES,
  COVERAGE_VERDICTS,
  type VendorDocumentType,
  VENDOR_DOCUMENT_TYPE_VALUES,
  VendorDocumentTypeEnum,
  ADDITIONAL_ENTITY_NAMES_LIMIT,
} from "@vendra/workflow/vendor";

// =============================================================================
// Processing stages
// =============================================================================

export type ProcessingStage =
  | "reading"
  | "analyzing"
  | "classifying"
  | "extracting"
  | "saving"
  | "validating"
  | "mapping"
  | "finalizing";

export const STAGE_INDEX: Record<ProcessingStage, number> = {
  reading: 1,
  analyzing: 2,
  classifying: 3,
  extracting: 4,
  saving: 5,
  validating: 6,
  mapping: 7,
  finalizing: 8,
};

export const TOTAL_STAGES = 8;

export const STAGE_MESSAGES: Record<ProcessingStage, string> = {
  reading: "Uploading and preparing your document...",
  analyzing: "Analyzing document content and structure...",
  classifying: "Identifying the type of document...",
  extracting: "Reading and extracting key information...",
  saving: "Saving extracted data...",
  validating: "Checking that all required information is present...",
  mapping: "Mapping this document to your compliance requirements...",
  finalizing: "Completing processing and updating your requirements...",
};

// =============================================================================
// Upload constants
// =============================================================================

export const MAX_FILES = 40;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

export const EXTENSION_BY_MIME: Record<AcceptedMimeType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

/** Client-gated concurrent per-document streams — aligned with the server's
 *  3-slot doc semaphore (§6.1). */
export const MAX_CONCURRENT_DOC_STREAMS = 3;

// =============================================================================
// UI-message data-part payloads (persistent family)
// =============================================================================

export interface VendorDocStagePart {
  status: "PENDING" | "PROCESSING";
  stage?: ProcessingStage;
}

export interface VendorDocExtractionPart {
  extractedData: Record<string, unknown>;
  fieldConfidences?: Record<string, number>;
}

export interface VendorDocValidationPart {
  valid: boolean;
  rules: ValidationRule[];
}

export const CONFIRMATION_KINDS = [
  "PARENT_POLICY_COVERS_SUBSIDIARY",
  "DBA_SAME_ENTITY",
  "BLANKET_ENDORSEMENT_APPLIES",
] as const;

export type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number];

export interface VendorDocConfirmationPart {
  confirmationUuid: string;
  kind: ConfirmationKind;
  question: string;
  entityName?: string;
  expiresAt: string;
  /** Re-written on the SAME part id once the window resolves. */
  settled?: boolean;
}

export interface VendorDocTerminalPart {
  status: "COMPLETED" | "FAILED";
  documentType?: string | null;
  documentSubtype?: string | null;
  validUploadType?: string | null;
  requirementsGranted: string[];
  reason?: string;
  failedValidations?: string[];
  /** Coverage-scoped categories on a FAILED doc — renders "Counted · coverage". */
  scopedCategories?: string[];
  crossDocumentRequirements?: string[];
}

export type VendorDocDataParts = {
  "vendor-doc-stage": VendorDocStagePart;
  "vendor-doc-extraction": VendorDocExtractionPart;
  "vendor-doc-validation": VendorDocValidationPart;
  "vendor-doc-confirmation": VendorDocConfirmationPart;
  "vendor-doc-terminal": VendorDocTerminalPart;
};

export type VendorDocUIMessage = UIMessage<never, VendorDocDataParts>;

// =============================================================================
// Coverage-determination progress stream (transient family — onData only)
// =============================================================================

export const COVERAGE_PROGRESS_STAGES = [
  "queued",
  "starting",
  "reviewing",
  "checking",
  "saving",
  "waiting-for-documents",
  "retrying",
  "converged",
  "unavailable",
] as const;

export type CoverageProgressStage = (typeof COVERAGE_PROGRESS_STAGES)[number];

export interface CoverageStagePart {
  stage: CoverageProgressStage;
  attempt?: number;
}

export interface CoverageNarrationPart {
  text: string;
}

export type CoverageDataParts = {
  "coverage-stage": CoverageStagePart;
  "coverage-narration": CoverageNarrationPart;
};

export type CoverageUIMessage = UIMessage<never, CoverageDataParts>;

const COVERAGE_STAGE_SET: ReadonlySet<string> = new Set(
  COVERAGE_PROGRESS_STAGES,
);

/** Runtime guard — `@ai-sdk/react` onData payloads arrive type-erased. */
export function parseCoverageStagePart(data: unknown): CoverageStagePart | null {
  if (data === null || typeof data !== "object") return null;
  const { stage, attempt } = data as { stage?: unknown; attempt?: unknown };
  if (typeof stage !== "string" || !COVERAGE_STAGE_SET.has(stage)) return null;
  return {
    stage: stage as CoverageProgressStage,
    ...(typeof attempt === "number" ? { attempt } : {}),
  };
}

export function parseCoverageNarrationPart(
  data: unknown,
): CoverageNarrationPart | null {
  if (data === null || typeof data !== "object") return null;
  const { text } = data as { text?: unknown };
  return typeof text === "string" ? { text } : null;
}

// =============================================================================
// Host-tool input schemas
// =============================================================================

/**
 * Canonicalize a model-emitted document type to the enum VALUE: trim +
 * uppercase, then map enum KEYS to values (models differ in how they echo
 * enum values — the contract is the SET of types, not their spelling).
 */
export function canonicalizeVendorDocumentType(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const upper = value.trim().toUpperCase();
  const keyMapped = (VendorDocumentTypeEnum as Record<string, string>)[upper];
  return keyMapped ?? upper;
}

export const saveClassificationInputSchema = z.object({
  documentType: z.preprocess(
    canonicalizeVendorDocumentType,
    z.enum(VENDOR_DOCUMENT_TYPE_VALUES),
  ),
  documentSubtype: z.string().max(200).optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(2000),
  /** Other ENTITIES whose documents share this file — advisory, never fails. */
  additionalEntityNames: z
    .array(z.string().min(1).max(160))
    .max(ADDITIONAL_ENTITY_NAMES_LIMIT)
    .optional(),
});

export type SaveClassificationInput = z.infer<
  typeof saveClassificationInputSchema
>;

/**
 * ⚠ HARD RULE: never z.record() in a bridge-crossing schema — the harness
 * bridge (≥1.0.47) round-trips schemas through JSON-Schema; z.record
 * serializes to a property-less object and deserializes as z.object({}),
 * which STRIPS every dynamic key. z.unknown() + host-side coerceRecord is
 * the shape.
 */
export const saveExtractionInputSchema = z.object({
  extractedData: z
    .unknown()
    .describe(
      "The extracted fields, as a JSON object keyed by the extraction jsonSchema's property names.",
    ),
  fieldConfidences: z
    .unknown()
    .optional()
    .describe("A 0-1 confidence per extracted field, as a JSON object."),
});

export type SaveExtractionInput = z.infer<typeof saveExtractionInputSchema>;

export const finalizeDocumentInputSchema = z.object({});

export const failDocumentInputSchema = z.object({
  reason: z.string().min(1).max(500),
});

/**
 * The coverage-determination lane's single save tool (§6.6) — sanity-checked
 * host-side (`validateCoverageDetermination`) so bad payloads bounce back for
 * the agent to correct.
 */
export const saveCoverageDeterminationInputSchema = z.object({
  lines: z
    .array(
      z.object({
        category: z.enum(COVERAGE_DETERMINATION_LINES),
        effectiveOccurrenceLimitUsd: z.number().nonnegative().nullable(),
        effectiveAggregateLimitUsd: z.number().nonnegative().nullable(),
        contributions: z
          .array(
            z.object({
              documentUuid: z.string().uuid(),
              role: z.enum(COVERAGE_CONTRIBUTION_ROLES),
              amountAppliedUsd: z.number().nonnegative(),
              reasoning: z.string().min(1).max(600),
            }),
          )
          .max(30),
        verdict: z.enum(COVERAGE_VERDICTS),
        reasoning: z.string().min(1).max(2000),
      }),
    )
    .max(8),
  conflicts: z.array(z.string().max(300)).max(20),
  narrative: z.string().max(4000),
});

export type SaveCoverageDeterminationToolInput = z.infer<
  typeof saveCoverageDeterminationInputSchema
>;

// =============================================================================
// Shared API types
// =============================================================================

export interface ExistingVendorDocProjection {
  documentUuid: string;
  fileKey: string;
  fileName: string;
  fileSizeBytes: number | null;
  uploadStatus:
    | "PENDING"
    | "UPLOADING"
    | "UPLOADED"
    | "PROCESSING"
    | "PROCESSED"
    | "FAILED"
    | "ERROR";
  extraction?: {
    documentType: string;
    documentSubtype: string | null;
    classificationConfidence: number | null;
    classificationReasoning: string | null;
    extractedData: Record<string, unknown>;
    fieldConfidences: Record<string, number> | null;
    validationRules: ValidationRule[] | null;
    validationValid: boolean | null;
    requirementsGranted: string[];
    validUploadType: string | null;
  };
  failureReason?: string;
  additionalEntityNames?: string[];
  waiverActive?: boolean;
  waiverScopedCategories?: string[];
  waiverExpiresAt?: string | null;
  manualGrants?: { category: string; grantedAt: string | null }[];
  /** Coverage-scoped acceptance on a FAILED doc. */
  scopedCategories?: string[];
  extractedExpirationDate?: string | null;
}

export interface UploadIntakeResponse {
  batchId: string;
  targets: {
    pointer: string;
    documentUuid: string;
    fileId: string;
    fileKey: string;
    uploadUrl: string;
  }[];
  failed: {
    pointer: string;
    fileName: string;
    reason: string;
  }[];
}

// =============================================================================
// Vendor assistant chat
// =============================================================================

/** Hard cap on one user message (schema-enforced server-side). */
export const ASSISTANT_MAX_MESSAGE_CHARS = 4_000;
/** Transcript tail loaded on panel mount. */
export const ASSISTANT_HISTORY_LIMIT = 80;

/**
 * Assistant messages carry no custom data parts — text, reasoning, and tool
 * parts only. Metadata `never`, matching the house `UIMessage` style.
 */
export type VendorAssistantUIMessage = UIMessage;

/**
 * One streamed turn. Identity is cookie-implied (the route resolves the
 * vendor from the better-auth session) — the body never names a vendor.
 * Text-only parts, per-part AND total caps, so the rate limiter and the
 * prompt envelope see bounded input.
 */
export const assistantChatRequestSchema = z.object({
  id: z.string().min(1).max(128),
  message: z.object({
    id: z.string().min(1).max(128),
    role: z.literal("user"),
    parts: z
      .array(
        z.object({
          type: z.literal("text"),
          text: z.string().min(1).max(ASSISTANT_MAX_MESSAGE_CHARS),
        }),
      )
      .min(1)
      .max(4)
      // Per-part caps alone don't bound the message — cap the SUM too.
      .refine(
        (parts) =>
          parts.reduce((sum, part) => sum + part.text.length, 0) <=
          ASSISTANT_MAX_MESSAGE_CHARS,
        { message: "Message exceeds the maximum length." },
      ),
  }),
});
export type AssistantChatRequest = z.infer<typeof assistantChatRequestSchema>;

export interface AssistantHistoryResponse {
  messages: VendorAssistantUIMessage[];
}

// Host-tool input schemas (assistant lane). Plain z.object only — never
// z.record across the harness bridge (see the hard rule above).
export const getComplianceStateInputSchema = z.object({});
export type GetComplianceStateInput = z.infer<
  typeof getComplianceStateInputSchema
>;

export const getDocumentDetailsInputSchema = z.object({
  documentUuid: z.string().min(1).describe("The document's uuid"),
});
export type GetDocumentDetailsInput = z.infer<
  typeof getDocumentDetailsInputSchema
>;

export const rememberFactsInputSchema = z.object({
  facts: z
    .array(z.string().min(1).max(300))
    .min(1)
    .max(5)
    .describe(
      "Durable, vendor-stated facts worth recalling in later sessions",
    ),
});
export type RememberFactsInput = z.infer<typeof rememberFactsInputSchema>;

// Snapshot shapes returned by the assistant host tools. These ride the UI
// stream and persist in the transcript — keep them PII-redacted at build
// time (see server/assistant/snapshot.ts).
export interface AssistantCategorySnapshot {
  category: string;
  label: string;
  status:
    | "complete"
    | "determining"
    | "dismissed"
    | "incomplete";
  mandatory: boolean;
  dismissible: boolean;
  grantSources: string[];
  contributingDocumentCount: number;
  failedDocumentCount: number;
  processingDocumentCount: number;
  expiresAt: string | null;
}

export interface AssistantDocumentSnapshot {
  documentUuid: string;
  fileName: string;
  uploadStatus: string;
  documentType: string | null;
  requirementsGranted: string[];
  failureReason: string | null;
  failedValidationMessages: string[];
}

export interface AssistantComplianceState {
  vendor: {
    legalName: string;
    dbaName: string | null;
    entityType: string | null;
    complianceStatus: string;
    registeredAt: string | null;
  };
  profileName: string;
  gate: {
    cleared: boolean;
    blocking: string[];
    missingMandatory: string[];
    dismissed: string[];
  };
  categories: AssistantCategorySnapshot[];
  documents: AssistantDocumentSnapshot[];
  coverage: {
    summarySource: "fresh" | "stale" | "none";
    determining: boolean;
    narrative: string | null;
  };
  nextExpiryAt: string | null;
  nowIso: string;
}

export interface AssistantDocumentDetails {
  documentUuid: string;
  fileName: string;
  uploadStatus: string;
  classification: {
    documentType: string | null;
    documentSubtype: string | null;
    confidence: number | null;
    reasoning: string | null;
  };
  extractedData: unknown;
  validation: {
    message: string;
    passed: boolean;
    informational?: boolean;
  }[];
}

/** Sanity guard: contract types stay aligned with the workflow enum. */
const _docTypeLockstep = (t: VendorDocumentType): string => t;
void _docTypeLockstep;
