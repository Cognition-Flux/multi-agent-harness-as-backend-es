/**
 * The recompute engine (SPEC §6.7) — the single cross-document requirement
 * fold. Every terminal doc write, every officer mutation, and every sweep
 * tick funnels through this one function.
 *
 * Contract:
 * - Mutation callers pass their OWN transaction so the fold sees the
 *   mutation it is folding (read-your-writes — a fold run on a separate
 *   connection reads stale state and converges on the wrong verdict);
 *   pipeline callers open a short tx here.
 * - The vendor row is re-read under FOR UPDATE before the metadata write.
 * - The coverage-determination categories fold from the determination
 *   authority ONLY (single-authority invariant) — per-doc extraction
 *   evidence never greens them.
 * - Sandbox-free by contract: recompute NEVER runs the harness — the
 *   coverage lane is kicked by routes, and its save tool calls back into
 *   this recompute so the fold converges.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema, type VendorDb } from "@vendra/db-vendor";
import {
  type ActivationGateResult,
  calculateActivationGate,
  computeCoverageSignature,
  deriveAutoDismissedCategories,
  deriveRequirementEvidence,
  evaluateCoverageFreshness,
  isInsuranceDocumentType,
  parseCoverageDetermination,
  type CoverageSignatureInput,
  type EvidenceDocInput,
  type RequirementCategoryType,
  type RequirementEvidenceResult,
  isCoverageDeterminationCategory,
  type VendorDocumentType,
  vendraError,
  vendraLog,
} from "@vendra/workflow/vendor";

import { parseWaiver } from "@/server/harness/db/page-load";
import { toRequirementProfile, toThresholds, toWorkProfile } from "@/server/profile";

const {
  apiCheckEvidence,
  manualRequirementGrant,
  vendor,
  vendorDocument,
  vendorDocumentExtraction,
  vendorRequirementProfile,
  vendorStatusTransition,
} = schema;

type Executor = VendorDb | Parameters<Parameters<VendorDb["transaction"]>[0]>[0];

export interface RecomputeResult {
  grantedCategories: RequirementCategoryType[];
  coverageFresh: boolean;
  coverageDetermining: boolean;
  coverageSignature: string;
  nextExpiryAt: string | null;
  gate: ActivationGateResult;
  evidence: RequirementEvidenceResult;
  complianceStatus: string;
}

/**
 * Build the evidence inputs for one vendor on the given executor — shared by
 * the recompute write path and read-only projections (traceability, gate).
 */
export async function loadVendorEvidence(
  executor: Executor,
  vendorId: number,
  now: Date,
): Promise<{
  vendorRow: typeof vendor.$inferSelect;
  profileRow: typeof vendorRequirementProfile.$inferSelect;
  docs: EvidenceDocInput[];
  docTypesByUuid: Map<string, string | null>;
  signature: string;
  determination: ReturnType<typeof parseCoverageDetermination>;
  determinationFresh: boolean;
  evidence: RequirementEvidenceResult;
  gate: ActivationGateResult;
}> {
  const [vendorRow] = await executor
    .select()
    .from(vendor)
    .where(eq(vendor.id, vendorId))
    .limit(1);
  if (!vendorRow) throw new Error(`Vendor ${vendorId} not found`);
  const [profileRow] = await executor
    .select()
    .from(vendorRequirementProfile)
    .where(eq(vendorRequirementProfile.id, vendorRow.requirementProfileId))
    .limit(1);
  if (!profileRow) throw new Error(`Requirement profile missing for vendor ${vendorId}`);

  const docRows = await executor
    .select()
    .from(vendorDocument)
    .where(eq(vendorDocument.vendorId, vendorId))
    .orderBy(vendorDocument.id);

  const docIds = docRows.map((d) => d.id);
  const extractionRows =
    docIds.length > 0
      ? await executor
          .select()
          .from(vendorDocumentExtraction)
          .where(inArray(vendorDocumentExtraction.documentId, docIds))
          .orderBy(desc(vendorDocumentExtraction.version))
      : [];
  const latestByDoc = new Map<number, (typeof extractionRows)[number]>();
  for (const row of extractionRows) {
    if (!latestByDoc.has(row.documentId)) latestByDoc.set(row.documentId, row);
  }

  // Manual grants read on the CALLER'S executor (read-your-writes).
  const grantRows =
    docIds.length > 0
      ? await executor
          .select()
          .from(manualRequirementGrant)
          .where(inArray(manualRequirementGrant.documentId, docIds))
      : [];
  const activeGrantsByDoc = new Map<number, string[]>();
  for (const grant of grantRows) {
    if (grant.revokedAt !== null) continue;
    const list = activeGrantsByDoc.get(grant.documentId) ?? [];
    list.push(grant.category);
    activeGrantsByDoc.set(grant.documentId, list);
  }

  const apiChecks = await executor
    .select()
    .from(apiCheckEvidence)
    .where(eq(apiCheckEvidence.vendorId, vendorId));

  const docs: EvidenceDocInput[] = [];
  const docTypesByUuid = new Map<string, string | null>();
  const signatureInputs: CoverageSignatureInput[] = [];
  for (const doc of docRows) {
    const extraction = latestByDoc.get(doc.id);
    const manualCategories = activeGrantsByDoc.get(doc.id) ?? [];
    const waiver = extraction ? parseWaiver(extraction.waiver) : null;
    docTypesByUuid.set(doc.uuid, extraction?.documentType ?? null);
    docs.push({
      documentUuid: doc.uuid,
      uploadStatus: doc.uploadStatus,
      documentType: extraction?.documentType ?? null,
      requirementsGranted: extraction?.requirementsGranted ?? [],
      scopedCategories: extraction?.scopedCategories ?? [],
      validationValid: extraction?.validationValid ?? null,
      waiver: waiver?.active
        ? {
            active: true,
            scopedCategories: waiver.scopedCategories,
            expiresAt: waiver.expiresAt,
          }
        : null,
      manualGrantCategories: manualCategories,
      extractedExpirationDate: doc.extractedExpirationDate,
    });
    // Coverage-lane input set: insurance docs + any doc carrying an active
    // manual grant for a coverage category — included unconditionally so
    // grant changes always perturb the signature.
    const isInsurance =
      extraction &&
      isInsuranceDocumentType(extraction.documentType as VendorDocumentType);
    const hasCoverageGrant = manualCategories.some((c) =>
      isCoverageDeterminationCategory(c),
    );
    if (isInsurance || hasCoverageGrant) {
      signatureInputs.push({
        documentUuid: doc.uuid,
        extractionVersion: extraction?.version ?? null,
        documentType: extraction?.documentType ?? null,
        uploadStatus: doc.uploadStatus,
        hasActiveCoverageManualGrant: hasCoverageGrant,
      });
    }
  }

  const thresholds = toThresholds(profileRow);
  const signature = computeCoverageSignature(signatureInputs, thresholds);
  const determination = parseCoverageDetermination(
    vendorRow.complianceStatusMetadata,
  );
  const determinationFresh =
    evaluateCoverageFreshness(determination, signature) === "fresh";

  const evidence = deriveRequirementEvidence({
    docs,
    determination,
    determinationFresh,
    apiChecks: apiChecks.map((c) => ({
      category: c.category,
      provider: c.provider,
      passed: c.passed,
      checkedAt: c.checkedAt.toISOString(),
      expiresAt: c.expiresAt?.toISOString().slice(0, 10) ?? null,
    })),
    now,
  });

  const profile = toRequirementProfile(profileRow);
  const gate = calculateActivationGate({
    profile,
    granted: evidence.granted,
    waived: new Map(), // waivers are folded as grant sources by the derivation
    manualDismissed: new Set(
      (vendorRow.dismissedCategories ?? []) as RequirementCategoryType[],
    ),
    autoDismissed: deriveAutoDismissedCategories(
      profile,
      toWorkProfile(vendorRow.workProfile),
    ),
    now,
  });

  return {
    vendorRow,
    profileRow,
    docs,
    docTypesByUuid,
    signature,
    determination,
    determinationFresh,
    evidence,
    gate,
  };
}

async function recomputeOnExecutor(
  executor: Executor,
  vendorId: number,
  inTx: boolean,
): Promise<RecomputeResult> {
  const startedAt = Date.now();
  const now = new Date();

  // Row-lock the vendor before the metadata write — mutation callers already
  // hold it (no-op re-acquire); pipeline callers get a short exclusive hold.
  await executor.execute(
    sql`SELECT id FROM ${vendor} WHERE id = ${vendorId} FOR UPDATE`,
  );

  const loaded = await loadVendorEvidence(executor, vendorId, now);
  const { vendorRow, evidence, gate, signature, determinationFresh } = loaded;

  const grantedCategories = [...evidence.granted.keys()];
  const determiningLines = [...evidence.byCategory.values()].filter(
    (entry) => entry.determining,
  );
  const coverageDetermining = determiningLines.length > 0;

  // Single-statement jsonb sibling-merge touching only our own keys.
  const fold = {
    granted: grantedCategories,
    coverage: {
      fresh: determinationFresh,
      determining: coverageDetermining,
      signature,
    },
    computed_at: now.toISOString(),
  };
  await executor
    .update(vendor)
    .set({
      complianceStatusMetadata: sql`COALESCE(${vendor.complianceStatusMetadata}, '{}'::jsonb) || jsonb_build_object('cross_document_requirements', ${JSON.stringify(fold)}::jsonb)`,
      nextExpiryAt: evidence.nextExpiryAt,
      updatedAt: sql`now()`,
    })
    .where(eq(vendor.id, vendorId));

  // Automatic status transitions on the recompute path (§6.8 symmetry):
  //  - NOT_STARTED → IN_PROGRESS once evidence exists.
  //  - EXPIRED → APPROVED when a valid renewal restores the gate (no officer
  //    touch — acceptance §13.4).
  let complianceStatus: string = vendorRow.complianceStatus;
  if (vendorRow.complianceStatus === "NOT_STARTED" && loaded.docs.length > 0) {
    complianceStatus = "IN_PROGRESS";
  } else if (vendorRow.complianceStatus === "EXPIRED" && gate.cleared) {
    complianceStatus = "APPROVED";
  }
  if (complianceStatus !== vendorRow.complianceStatus) {
    await executor
      .update(vendor)
      .set({ complianceStatus: complianceStatus as typeof vendorRow.complianceStatus })
      .where(eq(vendor.id, vendorId));
    await executor.insert(vendorStatusTransition).values({
      vendorId,
      fromStatus: vendorRow.complianceStatus,
      toStatus: complianceStatus,
      source: "gate",
    });
  }

  const result: RecomputeResult = {
    grantedCategories,
    coverageFresh: determinationFresh,
    coverageDetermining,
    coverageSignature: signature,
    nextExpiryAt: evidence.nextExpiryAt,
    gate,
    evidence,
    complianceStatus,
  };

  vendraLog("recompute.done", {
    vendor: vendorId,
    docs: loaded.docs.length,
    crossGranted: grantedCategories.length,
    ...(grantedCategories.length > 0
      ? { granted: grantedCategories.join(",") }
      : {}),
    coverageFresh: determinationFresh,
    determining: coverageDetermining,
    inTx,
    ms: Date.now() - startedAt,
  });

  return result;
}

/**
 * Recompute + persist the cross-document requirement fold for one vendor.
 * Pass `tx` from a mutation transaction (W1.3 contract) so the fold runs on
 * it; without one, a short transaction is opened here.
 */
export async function recomputeCrossDocumentRequirementsForVendor(
  vendorId: number,
  tx?: Executor,
): Promise<RecomputeResult> {
  if (tx) return recomputeOnExecutor(tx, vendorId, true);
  return getDb().transaction(async (innerTx) =>
    recomputeOnExecutor(innerTx, vendorId, false),
  );
}

/** Best-effort variant for pipeline paths — a failure never inverts a doc. */
export async function recomputeBestEffort(vendorId: number): Promise<void> {
  try {
    await recomputeCrossDocumentRequirementsForVendor(vendorId);
  } catch (err) {
    vendraError("recompute.failed", {
      vendor: vendorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
