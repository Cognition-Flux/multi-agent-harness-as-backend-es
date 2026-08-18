/**
 * The documents snapshot projection (SPEC §6.4) — the durable state the
 * vendor portal polls (~10s while processing) and the SSR bootstrap embeds.
 * Also the officer→vendor propagation channel (§8.5).
 */
import { desc, eq, inArray, isNull } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import type { ValidationRule } from "@vendra/workflow/vendor";

import type { ExistingVendorDocProjection } from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { ADDITIONAL_ENTITY_NAMES_METADATA_KEY } from "./documents";

const { manualRequirementGrant, vendorDocument, vendorDocumentExtraction } =
  schema;

interface ParsedWaiver {
  active: boolean;
  scopedCategories: string[];
  expiresAt: string | null;
}

export function parseWaiver(raw: unknown): ParsedWaiver | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  return {
    active: w.active === true,
    scopedCategories: Array.isArray(w.scopedCategories)
      ? (w.scopedCategories as unknown[]).filter(
          (c): c is string => typeof c === "string",
        )
      : [],
    expiresAt: typeof w.expiresAt === "string" ? w.expiresAt : null,
  };
}

export async function loadDocumentsSnapshot(
  vendorId: number,
): Promise<ExistingVendorDocProjection[]> {
  const db = getDb();
  const docs = await db
    .select()
    .from(vendorDocument)
    .where(eq(vendorDocument.vendorId, vendorId))
    .orderBy(vendorDocument.id);
  if (docs.length === 0) return [];

  const docIds = docs.map((d) => d.id);
  const extractions = await db
    .select()
    .from(vendorDocumentExtraction)
    .where(inArray(vendorDocumentExtraction.documentId, docIds))
    .orderBy(desc(vendorDocumentExtraction.version));
  const latestByDoc = new Map<number, (typeof extractions)[number]>();
  for (const row of extractions) {
    if (!latestByDoc.has(row.documentId)) latestByDoc.set(row.documentId, row);
  }

  const grants = await db
    .select()
    .from(manualRequirementGrant)
    .where(
      inArray(manualRequirementGrant.documentId, docIds),
    );
  const activeGrantsByDoc = new Map<
    number,
    { category: string; grantedAt: string | null }[]
  >();
  for (const grant of grants) {
    if (grant.revokedAt !== null) continue;
    const list = activeGrantsByDoc.get(grant.documentId) ?? [];
    list.push({
      category: grant.category,
      grantedAt: grant.grantedAt?.toISOString() ?? null,
    });
    activeGrantsByDoc.set(grant.documentId, list);
  }

  return docs.map((doc) => {
    const meta = (doc.fileMetadata ?? {}) as Record<string, unknown>;
    const extraction = latestByDoc.get(doc.id);
    const waiver = extraction ? parseWaiver(extraction.waiver) : null;
    const projection: ExistingVendorDocProjection = {
      documentUuid: doc.uuid,
      fileKey: doc.fileKey,
      fileName:
        typeof meta.fileName === "string"
          ? meta.fileName
          : doc.fileKey.split("/").pop() ?? doc.fileKey,
      fileSizeBytes:
        typeof meta.fileSizeBytes === "number" ? meta.fileSizeBytes : null,
      uploadStatus: doc.uploadStatus,
      extractedExpirationDate: doc.extractedExpirationDate,
    };
    if (typeof meta.failureReason === "string") {
      projection.failureReason = meta.failureReason;
    }
    const extraNames = meta[ADDITIONAL_ENTITY_NAMES_METADATA_KEY];
    if (Array.isArray(extraNames) && extraNames.length > 0) {
      projection.additionalEntityNames = extraNames.filter(
        (n): n is string => typeof n === "string",
      );
    }
    if (extraction) {
      projection.extraction = {
        documentType: extraction.documentType,
        documentSubtype: extraction.documentSubtype,
        classificationConfidence: extraction.classificationConfidence,
        classificationReasoning: extraction.classificationReasoning,
        extractedData: (extraction.extractedData ?? {}) as Record<
          string,
          unknown
        >,
        fieldConfidences: (extraction.fieldConfidences ?? null) as Record<
          string,
          number
        > | null,
        validationRules: (extraction.validationRules ?? null) as
          | ValidationRule[]
          | null,
        validationValid: extraction.validationValid,
        requirementsGranted: extraction.requirementsGranted ?? [],
        validUploadType: doc.uploadType,
      };
      if ((extraction.scopedCategories ?? []).length > 0) {
        projection.scopedCategories = extraction.scopedCategories;
      }
      if (waiver?.active) {
        projection.waiverActive = true;
        projection.waiverScopedCategories = waiver.scopedCategories;
        projection.waiverExpiresAt = waiver.expiresAt;
      }
    }
    const activeGrants = activeGrantsByDoc.get(doc.id);
    if (activeGrants && activeGrants.length > 0) {
      projection.manualGrants = activeGrants;
    }
    return projection;
  });
}
