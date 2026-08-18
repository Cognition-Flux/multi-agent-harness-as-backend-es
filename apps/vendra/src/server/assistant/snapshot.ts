/**
 * Read-only compliance-state projections for the assistant's host tools.
 *
 * Both builders reuse the SAME derivations the page renders from
 * (buildComplianceSummary + loadDocumentsSnapshot), so the assistant can
 * never disagree with the UI. Tool outputs ride the UI stream and persist
 * in the transcript, so anything TIN/SSN-shaped is masked here even though
 * extraction already masks at persist time (defense in depth).
 */
import type {
  AssistantComplianceState,
  AssistantDocumentDetails,
  AssistantDocumentSnapshot,
  ExistingVendorDocProjection,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { buildComplianceSummary } from "@/server/compliance-summary";
import { loadDocumentsSnapshot } from "@/server/harness/db/page-load";

/** Mask anything SSN/EIN-shaped, keeping the last 4 digits for reference. */
function maskTaxIdText(value: string): string {
  return value
    .replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?(\d{4})\b/g, "•••-••-$1")
    .replace(/\b\d{2}-\d{3}(\d{4})\b/g, "••-•••$1");
}

/**
 * Recursively mask tax-id-looking values. Keys matching tin/ssn/ein/tax_id
 * are masked to their last 4 digits; every string value is pattern-masked.
 */
function redactExtractedData(value: unknown): unknown {
  if (typeof value === "string") return maskTaxIdText(value);
  // A bare 9-digit NUMBER under any key is tax-id-shaped — mask it too
  // (the extraction agent may emit EINs/SSNs as JSON numbers).
  if (typeof value === "number" && /^\d{9}$/.test(String(value))) {
    return `•••${String(value).slice(-4)}`;
  }
  if (Array.isArray(value)) return value.map(redactExtractedData);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      // `tin` must also match camelCase/underscore composites (taxpayerTin,
      // tin_number) that \b cannot, without over-matching "destination".
      if (
        /ssn|social_security|tax_?id|ein|(?:^|[^a-z0-9])tin|tin(?:[^a-z0-9]|$)/i.test(
          key,
        ) &&
        (typeof v === "string" || typeof v === "number" || typeof v === "bigint")
      ) {
        const digits = String(v).replace(/\D/g, "");
        out[key] = digits.length >= 4 ? `•••${digits.slice(-4)}` : "•••";
      } else {
        out[key] = redactExtractedData(v);
      }
    }
    return out;
  }
  return value;
}

function failedValidationMessages(
  rules:
    | { passed: boolean; message: string; informational?: boolean }[]
    | null
    | undefined,
): string[] {
  return (rules ?? [])
    .filter((rule) => !rule.passed && !rule.informational)
    .map((rule) => rule.message);
}

function toDocumentSnapshot(
  doc: ExistingVendorDocProjection,
): AssistantDocumentSnapshot {
  return {
    documentUuid: doc.documentUuid,
    fileName: doc.fileName,
    uploadStatus: doc.uploadStatus,
    documentType: doc.extraction?.documentType ?? null,
    requirementsGranted: doc.extraction?.requirementsGranted ?? [],
    failureReason: doc.failureReason ?? null,
    failedValidationMessages: failedValidationMessages(
      doc.extraction?.validationRules,
    ),
  };
}

/** The whole compliance record, shaped for the chat transcript. */
export async function buildComplianceState(
  vendorId: number,
): Promise<AssistantComplianceState> {
  const [summary, documents] = await Promise.all([
    buildComplianceSummary(vendorId),
    loadDocumentsSnapshot(vendorId),
  ]);

  return {
    vendor: {
      legalName: summary.vendor.legalName,
      dbaName: summary.vendor.dbaName,
      entityType: summary.vendor.entityType,
      complianceStatus: summary.vendor.complianceStatus,
      registeredAt: summary.vendor.registeredAt,
    },
    profileName: summary.profile.name,
    gate: {
      cleared: summary.gate.cleared,
      blocking: summary.gate.blocking,
      missingMandatory: summary.gate.missingMandatory,
      dismissed: summary.gate.dismissed,
    },
    categories: summary.categories.map((cat) => ({
      category: cat.category,
      label: cat.label,
      status: cat.dismissed
        ? ("dismissed" as const)
        : cat.granted
          ? ("complete" as const)
          : cat.determining
            ? ("determining" as const)
            : ("incomplete" as const),
      mandatory: cat.mandatory,
      dismissible: cat.dismissible,
      grantSources: cat.grantSources.map((s) => s.kind),
      contributingDocumentCount: cat.contributingDocumentUuids.length,
      failedDocumentCount: cat.failedDocumentUuids.length,
      processingDocumentCount: cat.processingDocumentUuids.length,
      expiresAt: cat.expiresAt,
    })),
    documents: documents.map(toDocumentSnapshot),
    coverage: {
      summarySource: summary.coverage.summarySource,
      determining: summary.coverage.determining,
      narrative: summary.coverage.narrative,
    },
    nextExpiryAt: summary.nextExpiryAt,
    nowIso: new Date().toISOString(),
  };
}

/** One document in depth, or null when the uuid isn't this vendor's. */
export async function buildDocumentDetails(
  vendorId: number,
  documentUuid: string,
): Promise<AssistantDocumentDetails | null> {
  const documents = await loadDocumentsSnapshot(vendorId);
  const doc = documents.find((d) => d.documentUuid === documentUuid);
  if (!doc) return null;
  return {
    documentUuid: doc.documentUuid,
    fileName: doc.fileName,
    uploadStatus: doc.uploadStatus,
    classification: {
      documentType: doc.extraction?.documentType ?? null,
      documentSubtype: doc.extraction?.documentSubtype ?? null,
      confidence: doc.extraction?.classificationConfidence ?? null,
      reasoning: doc.extraction?.classificationReasoning ?? null,
    },
    extractedData: redactExtractedData(doc.extraction?.extractedData ?? null),
    validation: (doc.extraction?.validationRules ?? []).map((rule) => ({
      message: rule.message,
      passed: rule.passed,
      ...(rule.informational ? { informational: true } : {}),
    })),
  };
}
