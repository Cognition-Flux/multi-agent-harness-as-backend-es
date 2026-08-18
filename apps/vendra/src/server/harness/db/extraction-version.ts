/**
 * Append-only extraction versions (SPEC §6.10): saveExtraction inserts a
 * new version row; reclassify inserts version+1 with waiver state reset —
 * never mutates history.
 */
import { desc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import type { ValidationRule } from "@vendra/workflow/vendor";

const { vendorDocumentExtraction } = schema;

export type ExtractionRow = typeof vendorDocumentExtraction.$inferSelect;

export interface InsertExtractionVersionInput {
  documentId: number;
  documentType: string;
  documentSubtype?: string | null;
  classificationConfidence?: number | null;
  classificationReasoning?: string | null;
  extractedData: Record<string, unknown>;
  fieldConfidences?: Record<string, unknown> | null;
  model?: string | null;
  source?: string;
}

/** Insert the next extraction version for a document; returns the version. */
export async function insertExtractionVersion(
  input: InsertExtractionVersionInput,
): Promise<number> {
  const db = getDb();
  const [latest] = await db
    .select({ version: vendorDocumentExtraction.version })
    .from(vendorDocumentExtraction)
    .where(eq(vendorDocumentExtraction.documentId, input.documentId))
    .orderBy(desc(vendorDocumentExtraction.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  await db.insert(vendorDocumentExtraction).values({
    documentId: input.documentId,
    version,
    documentType: input.documentType,
    documentSubtype: input.documentSubtype ?? null,
    classificationConfidence: input.classificationConfidence ?? null,
    classificationReasoning: input.classificationReasoning ?? null,
    extractedData: input.extractedData,
    fieldConfidences: input.fieldConfidences ?? null,
    model: input.model ?? null,
    source: input.source ?? "harness",
  });
  return version;
}

/** The latest extraction row for a document, if any. */
export async function getLatestExtraction(
  documentId: number,
): Promise<ExtractionRow | null> {
  const [row] = await getDb()
    .select()
    .from(vendorDocumentExtraction)
    .where(eq(vendorDocumentExtraction.documentId, documentId))
    .orderBy(desc(vendorDocumentExtraction.version))
    .limit(1);
  return row ?? null;
}

async function latestExtractionId(documentId: number): Promise<number | null> {
  const [row] = await getDb()
    .select({ id: vendorDocumentExtraction.id })
    .from(vendorDocumentExtraction)
    .where(eq(vendorDocumentExtraction.documentId, documentId))
    .orderBy(desc(vendorDocumentExtraction.version))
    .limit(1);
  return row?.id ?? null;
}

export async function writeValidationToLatestExtraction(
  documentId: number,
  rules: ValidationRule[],
  valid: boolean,
): Promise<void> {
  const id = await latestExtractionId(documentId);
  if (id === null) return;
  await getDb()
    .update(vendorDocumentExtraction)
    .set({ validationRules: rules, validationValid: valid })
    .where(eq(vendorDocumentExtraction.id, id));
}

export async function updateLatestExtractionRequirements(
  documentId: number,
  requirementsGranted: string[],
  scopedCategories: string[],
): Promise<void> {
  const id = await latestExtractionId(documentId);
  if (id === null) return;
  await getDb()
    .update(vendorDocumentExtraction)
    .set({ requirementsGranted, scopedCategories })
    .where(eq(vendorDocumentExtraction.id, id));
}
