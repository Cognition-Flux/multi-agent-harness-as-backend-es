/**
 * Document-lifecycle queries for the Vendra harness pipeline (SPEC §6.1).
 * Terminal writes are compare-and-swap guarded on upload_status so a
 * concurrent cancel/failure can never be overwritten, and file_metadata
 * updates are jsonb merges.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import type { CompanyPolicy } from "@vendra/workflow/vendor";

import { loadVendorCompanyPolicy } from "@/server/company-policy";
import { normalizeAdditionalEntityNames } from "@vendra/workflow/vendor";

const { organization, vendor, vendorActivity, vendorDocument, vendorRequirementProfile } =
  schema;

export type DocumentRow = typeof vendorDocument.$inferSelect;
export type VendorRow = typeof vendor.$inferSelect;
export type ActivityType = (typeof vendorActivity.$inferSelect)["type"];

export const ADDITIONAL_ENTITY_NAMES_METADATA_KEY = "additionalEntityNames";

export interface InsertPendingDocumentInput {
  organizationId: number;
  vendorId: number;
  fileKey: string;
  batchId: string;
  fileId: string;
}

/** Create the document row in PENDING before the file bytes land. */
export async function insertPendingDocument(
  input: InsertPendingDocumentInput,
): Promise<DocumentRow> {
  const [row] = await getDb()
    .insert(vendorDocument)
    .values({
      organizationId: input.organizationId,
      vendorId: input.vendorId,
      fileKey: input.fileKey,
      uploadStatus: "PENDING",
      fileMetadata: {
        batchId: input.batchId,
        fileId: input.fileId,
        createdAt: new Date().toISOString(),
      },
    })
    .returning();
  if (!row) throw new Error("insertPendingDocument: insert returned no row");
  return row;
}

export interface UploadedFileFacts {
  mediaType: string;
  fileName: string;
  fileSizeBytes: number;
}

/**
 * Merge the client-declared upload facts into file_metadata WITHOUT a status
 * flip (row stays PENDING) — /process verifies the bytes at claim time.
 * PENDING-guarded so a later transition is never clobbered.
 */
export async function mergePendingFileFacts(
  documentUuid: string,
  facts: UploadedFileFacts,
): Promise<void> {
  await getDb()
    .update(vendorDocument)
    .set({
      fileMetadata: sql`COALESCE(${vendorDocument.fileMetadata}, '{}'::jsonb) || jsonb_build_object('type', ${facts.mediaType}::text, 'fileName', ${facts.fileName}::text, 'fileSizeBytes', ${facts.fileSizeBytes}::int)`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(vendorDocument.uuid, documentUuid),
        eq(vendorDocument.uploadStatus, "PENDING"),
      ),
    );
}

/** Advisory record of other entities' documents inside this same file. */
export async function recordAdditionalEntityNames(
  documentUuid: string,
  names: readonly string[],
): Promise<void> {
  const normalized = normalizeAdditionalEntityNames(names);
  await getDb()
    .update(vendorDocument)
    .set({
      fileMetadata: sql`COALESCE(${vendorDocument.fileMetadata}, '{}'::jsonb) || jsonb_build_object(${ADDITIONAL_ENTITY_NAMES_METADATA_KEY}::text, ${JSON.stringify(normalized)}::jsonb)`,
      updatedAt: sql`now()`,
    })
    .where(eq(vendorDocument.uuid, documentUuid));
}

/** Direct PENDING → FAILED flip for an upload whose bytes never landed. */
export async function failPendingUpload(
  documentUuid: string,
  failureReason: string,
): Promise<void> {
  await getDb()
    .update(vendorDocument)
    .set({
      uploadStatus: "FAILED",
      fileMetadata: sql`COALESCE(${vendorDocument.fileMetadata}, '{}'::jsonb) || jsonb_build_object('failureReason', ${failureReason}::text)`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(vendorDocument.uuid, documentUuid),
        eq(vendorDocument.uploadStatus, "PENDING"),
      ),
    );
}

/**
 * CAS: PENDING/UPLOADED/FAILED/ERROR → PROCESSING. Returns false when the
 * row was not in a claimable state (another worker already claimed it).
 */
export async function casToProcessing(documentUuid: string): Promise<boolean> {
  const rows = await getDb()
    .update(vendorDocument)
    .set({ uploadStatus: "PROCESSING", updatedAt: sql`now()` })
    .where(
      and(
        eq(vendorDocument.uuid, documentUuid),
        inArray(vendorDocument.uploadStatus, [
          "PENDING",
          "UPLOADED",
          "FAILED",
          "ERROR",
        ]),
      ),
    )
    .returning({ id: vendorDocument.id });
  return rows.length > 0;
}

/** CAS: only flip PROCESSING → PROCESSED (+ uploadType + expiration index). */
export async function casProcessed(
  documentUuid: string,
  uploadType: string | null,
  extractedExpirationDate: string | null,
): Promise<boolean> {
  const rows = await getDb()
    .update(vendorDocument)
    .set({
      uploadStatus: "PROCESSED",
      uploadType,
      extractedExpirationDate,
      // A prior failed attempt's reason must not shadow a successful run
      // (SPEC §17 C3) — the officer view renders it beside the pill.
      fileMetadata: sql`COALESCE(${vendorDocument.fileMetadata}, '{}'::jsonb) - 'failureReason'`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(vendorDocument.uuid, documentUuid),
        eq(vendorDocument.uploadStatus, "PROCESSING"),
      ),
    )
    .returning({ id: vendorDocument.id });
  return rows.length > 0;
}

/** CAS: only flip PROCESSING → FAILED — never regress a terminal row. */
export async function casFailed(
  documentUuid: string,
  failureReason?: string,
): Promise<boolean> {
  const rows = await getDb()
    .update(vendorDocument)
    .set({
      uploadStatus: "FAILED",
      updatedAt: sql`now()`,
      ...(failureReason !== undefined
        ? {
            fileMetadata: sql`COALESCE(${vendorDocument.fileMetadata}, '{}'::jsonb) || jsonb_build_object('failureReason', ${failureReason}::text)`,
          }
        : {}),
    })
    .where(
      and(
        eq(vendorDocument.uuid, documentUuid),
        eq(vendorDocument.uploadStatus, "PROCESSING"),
      ),
    )
    .returning({ id: vendorDocument.id });
  return rows.length > 0;
}

/** UPLOADED-guarded reset target for the officer retry (reset-only, §8.3). */
export async function casResetForRetry(documentUuid: string): Promise<boolean> {
  const rows = await getDb()
    .update(vendorDocument)
    .set({ uploadStatus: "UPLOADED", updatedAt: sql`now()` })
    .where(
      and(
        eq(vendorDocument.uuid, documentUuid),
        inArray(vendorDocument.uploadStatus, ["FAILED", "ERROR"]),
      ),
    )
    .returning({ id: vendorDocument.id });
  return rows.length > 0;
}

export interface InsertActivityInput {
  vendorId: number;
  organizationId: number;
  type: ActivityType;
  actorUserId?: string | null;
  documentId?: number | null;
  metadata?: unknown;
}

/** Append a vendor_activity audit row. */
export async function insertActivity(input: InsertActivityInput): Promise<void> {
  await getDb().insert(vendorActivity).values({
    vendorId: input.vendorId,
    organizationId: input.organizationId,
    type: input.type,
    actorUserId: input.actorUserId ?? null,
    documentId: input.documentId ?? null,
    metadata: input.metadata,
  });
}

export interface DocumentRunContext {
  document: DocumentRow;
  vendor: VendorRow;
  organization: typeof organization.$inferSelect;
  profile: typeof vendorRequirementProfile.$inferSelect;
  /**
   * The governance policy this vendor is judged under (SPEC §19). Null only
   * before the first policy exists for the org — every consumer falls back to
   * pre-governance behaviour in that case.
   */
  policy: CompanyPolicy | null;
}

/**
 * Everything the process route needs for one document run: the document row
 * plus its vendor, organization, requirement profile, and governance policy.
 */
export async function getDocumentRunContext(
  documentUuid: string,
): Promise<DocumentRunContext | null> {
  const [row] = await getDb()
    .select({
      document: vendorDocument,
      vendor,
      organization,
      profile: vendorRequirementProfile,
    })
    .from(vendorDocument)
    .innerJoin(vendor, eq(vendorDocument.vendorId, vendor.id))
    .innerJoin(organization, eq(vendorDocument.organizationId, organization.id))
    .innerJoin(
      vendorRequirementProfile,
      eq(vendor.requirementProfileId, vendorRequirementProfile.id),
    )
    .where(eq(vendorDocument.uuid, documentUuid))
    .limit(1);
  if (!row) return null;
  // The pinned version, so activating a new policy never re-judges a run that
  // is already in flight (§19.3).
  const policy = await loadVendorCompanyPolicy(row.vendor);
  return { ...row, policy };
}

/** All document rows for one vendor, oldest first. */
export async function listDocumentsForVendor(
  vendorId: number,
): Promise<DocumentRow[]> {
  return getDb()
    .select()
    .from(vendorDocument)
    .where(eq(vendorDocument.vendorId, vendorId))
    .orderBy(vendorDocument.id);
}
