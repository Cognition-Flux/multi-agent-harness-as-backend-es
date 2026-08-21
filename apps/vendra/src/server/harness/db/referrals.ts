/**
 * Requirement referrals (SPEC §19.4): the categories policy would not let the
 * automated pipeline settle, waiting for an officer.
 *
 * Contrast with `document_confirmation`, which this deliberately is not: that
 * mechanism has an expiry and a default answer, and the run FAILS OPEN when it
 * lapses. A referral has neither — an unanswered governance question must never
 * resolve itself.
 *
 * **One writer.** The referee gate lives in `deriveRequirementEvidence` (the
 * single authority on what is granted), so referrals are reconciled from that
 * fold's result, inside the recompute's transaction and row lock. The document
 * lane does not write them: it cannot, because a coverage category never grants
 * from a document row at all.
 */
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import type {
  CategoryEvidence,
  RequirementCategoryType,
} from "@vendra/workflow/vendor";

import { vendraLog } from "../log";

const { requirementReferral, vendorActivity } = schema;

type VendorDb = ReturnType<typeof getDb>;
type Executor = VendorDb | Parameters<Parameters<VendorDb["transaction"]>[0]>[0];

export interface ReconcileInput {
  vendorId: number;
  organizationId: number;
  /** The fold's per-category evidence — `referred` drives everything here. */
  evidenceByCategory: Map<RequirementCategoryType, CategoryEvidence>;
}

export interface ReconcileResult {
  opened: RequirementCategoryType[];
  closed: RequirementCategoryType[];
}

/**
 * Bring the open-referral set in line with the fold:
 *
 *  - open one for every category the fold withheld and that has none open;
 *  - close every open one whose category the fold no longer withholds — an
 *    officer granted it, a waiver reached it, or the evidence changed. Leaving
 *    those open would ask a question whose answer no longer matters.
 *
 * Idempotent by construction: the `requirement_referral_open_uq` partial index
 * makes the insert a no-op when a question is already pending.
 */
export async function reconcileRequirementReferrals(
  executor: Executor,
  input: ReconcileInput,
): Promise<ReconcileResult> {
  const referred: RequirementCategoryType[] = [];
  const evidenceFor = new Map<string, CategoryEvidence>();
  for (const entry of input.evidenceByCategory.values()) {
    if (!entry.referred) continue;
    referred.push(entry.category);
    evidenceFor.set(entry.category, entry);
  }

  // --- close what is no longer withheld -------------------------------------
  const closed = await executor
    .update(requirementReferral)
    .set({
      resolvedAt: sql`now()`,
      resolution: "SUPERSEDED",
      note: "La categoría dejó de requerir ratificación (otorgada o sin evidencia pendiente).",
    })
    .where(
      and(
        eq(requirementReferral.vendorId, input.vendorId),
        isNull(requirementReferral.resolvedAt),
        referred.length > 0
          ? notInArray(requirementReferral.category, referred)
          : sql`true`,
      ),
    )
    .returning({ category: requirementReferral.category });

  // --- open what is newly withheld -----------------------------------------
  let opened: { category: string }[] = [];
  if (referred.length > 0) {
    opened = await executor
      .insert(requirementReferral)
      .values(
        referred.map((category) => {
          const entry = evidenceFor.get(category);
          return {
            vendorId: input.vendorId,
            // Vendor-level: the withheld evidence may come from several
            // documents, or from the coverage determination (no document at all).
            documentId: null,
            category,
            proposedVerdict: "GRANT",
            proposedBy: "AGENT",
            evidence: {
              // What the pipeline would have granted from, for the officer.
              withheldSources: (entry?.referredSources ?? []).map((source) => ({
                kind: source.kind,
                documentUuid: source.documentUuid ?? null,
                expiresAt: source.expiresAt ?? null,
              })),
              grantingDocumentUuids: entry?.grantingDocumentUuids ?? [],
              contributingDocumentUuids: entry?.contributingDocumentUuids ?? [],
            },
          };
        }),
      )
      // A question is already pending for this (vendor, category).
      .onConflictDoNothing()
      .returning({ category: requirementReferral.category });
  }

  const openedCategories = opened.map((r) => r.category as RequirementCategoryType);
  const closedCategories = closed.map((r) => r.category as RequirementCategoryType);

  if (openedCategories.length > 0) {
    await executor.insert(vendorActivity).values({
      vendorId: input.vendorId,
      organizationId: input.organizationId,
      type: "REQUIREMENT_REFERRED",
      metadata: { categories: openedCategories },
    });
  }
  if (closedCategories.length > 0) {
    await executor.insert(vendorActivity).values({
      vendorId: input.vendorId,
      organizationId: input.organizationId,
      type: "REQUIREMENT_REFERRAL_RESOLVED",
      metadata: { categories: closedCategories, resolution: "SUPERSEDED" },
    });
  }
  if (openedCategories.length > 0 || closedCategories.length > 0) {
    vendraLog("policy.referrals_reconciled", {
      vendor: input.vendorId,
      opened: openedCategories.join(",") || undefined,
      closed: closedCategories.join(",") || undefined,
    });
  }
  return { opened: openedCategories, closed: closedCategories };
}

/** Open referrals for one vendor — the officer queue's read model. */
/**
 * Is this category's grant currently withheld from the pipeline, waiting on an
 * officer? Read inside the caller's transaction, because the one caller that
 * needs it (`grantRequirement`) decides under a document row lock.
 */
export async function hasOpenReferral(
  vendorId: number,
  category: string,
  executor: Executor = getDb(),
): Promise<boolean> {
  const [row] = await executor
    .select({ id: requirementReferral.id })
    .from(requirementReferral)
    .where(
      and(
        eq(requirementReferral.vendorId, vendorId),
        eq(requirementReferral.category, category),
        isNull(requirementReferral.resolvedAt),
      ),
    )
    .limit(1);
  return !!row;
}

export async function listOpenReferrals(vendorId: number) {
  return getDb()
    .select()
    .from(requirementReferral)
    .where(
      and(
        eq(requirementReferral.vendorId, vendorId),
        isNull(requirementReferral.resolvedAt),
      ),
    )
    .orderBy(requirementReferral.raisedAt);
}

/** Categories with an open referral, keyed by vendor — for roster projections. */
export async function openReferralCategories(
  vendorIds: readonly number[],
): Promise<Map<number, RequirementCategoryType[]>> {
  const byVendor = new Map<number, RequirementCategoryType[]>();
  if (vendorIds.length === 0) return byVendor;
  const rows = await getDb()
    .select({
      vendorId: requirementReferral.vendorId,
      category: requirementReferral.category,
    })
    .from(requirementReferral)
    .where(
      and(
        inArray(requirementReferral.vendorId, [...vendorIds]),
        isNull(requirementReferral.resolvedAt),
      ),
    );
  for (const row of rows) {
    const list = byVendor.get(row.vendorId) ?? [];
    list.push(row.category as RequirementCategoryType);
    byVendor.set(row.vendorId, list);
  }
  return byVendor;
}
