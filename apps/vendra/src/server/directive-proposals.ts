/**
 * Directive proposals (SPEC §24.2) — the HITL queue between an EMPOWERED
 * assistant and the superadmin.
 *
 * Single-writer discipline, referrals.ts style: the proposal tool creates rows
 * here, the platform router resolves them here, and both sides write their
 * `vendor_activity` entries in the same call so the ledger can never miss a
 * lifecycle event. Rule 7: Drizzle only.
 */
import { and, count, desc, eq, isNull, ne } from "drizzle-orm";

import { getDb, schema, type VendorDb } from "@vendra/db-vendor";
import type { DirectiveDiff } from "@vendra/workflow/vendor";

import type { AdmissionDecision } from "@/server/policy-admission";

const { directiveProposal, vendorActivity } = schema;

type Executor = VendorDb | Parameters<Parameters<VendorDb["transaction"]>[0]>[0];

export type DirectiveProposalRow = typeof directiveProposal.$inferSelect;

/** The full proposed-policy snapshot persisted on the row (§24.2). */
export interface ProposedPolicySnapshot {
  assistantPrivilege: string;
  refereeableCategories: string[];
  documents: {
    documentType: string;
    extractFields: string[];
    validators: string[];
  }[];
}

/**
 * Open a proposal (one transaction: row + DIRECTIVE_PROPOSED activity).
 * The partial unique `directive_proposal_open_uq` makes a second open proposal
 * from the same vendor a constraint error — callers check first and treat a
 * race's error as "already open".
 */
export async function createDirectiveProposal(input: {
  organizationId: number;
  vendorId: number;
  basePolicyId: number;
  diff: DirectiveDiff;
  proposedPolicy: ProposedPolicySnapshot;
  /** Already redacted by the caller. */
  rationale: string;
  gateVerdict: AdmissionDecision;
}): Promise<{ uuid: string }> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(directiveProposal)
      .values({
        organizationId: input.organizationId,
        vendorId: input.vendorId,
        basePolicyId: input.basePolicyId,
        diff: input.diff,
        proposedPolicy: input.proposedPolicy,
        rationale: input.rationale,
        gateVerdict: input.gateVerdict,
      })
      .returning({ uuid: directiveProposal.uuid });
    if (!row) throw new Error("directive proposal insert returned no row");
    await tx.insert(vendorActivity).values({
      vendorId: input.vendorId,
      organizationId: input.organizationId,
      type: "DIRECTIVE_PROPOSED",
      metadata: {
        proposalUuid: row.uuid,
        admissible: input.gateVerdict.admissible,
        rationaleLen: input.rationale.length,
      },
    });
    return row;
  });
}

export async function getOpenProposalForVendor(
  vendorId: number,
  executor: Executor = getDb(),
): Promise<DirectiveProposalRow | null> {
  const [row] = await executor
    .select()
    .from(directiveProposal)
    .where(
      and(
        eq(directiveProposal.vendorId, vendorId),
        isNull(directiveProposal.resolvedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The raising vendor's own proposals, newest first — the tool's read model. */
export async function listProposalsForVendor(
  vendorId: number,
  limit = 10,
): Promise<DirectiveProposalRow[]> {
  return getDb()
    .select()
    .from(directiveProposal)
    .where(eq(directiveProposal.vendorId, vendorId))
    .orderBy(desc(directiveProposal.raisedAt), desc(directiveProposal.id))
    .limit(limit);
}

/** Every proposal of one org, open first then newest — the console's model. */
export async function listProposalsForOrg(
  organizationId: number,
  limit = 50,
): Promise<DirectiveProposalRow[]> {
  const rows = await getDb()
    .select()
    .from(directiveProposal)
    .where(eq(directiveProposal.organizationId, organizationId))
    .orderBy(desc(directiveProposal.raisedAt), desc(directiveProposal.id))
    .limit(limit);
  return rows.sort((a, b) => Number(!!a.resolvedAt) - Number(!!b.resolvedAt));
}

/** Open-proposal counts per org — the roster badge. */
export async function countOpenProposalsByOrg(): Promise<Map<number, number>> {
  const rows = await getDb()
    .select({ organizationId: directiveProposal.organizationId, n: count() })
    .from(directiveProposal)
    .where(isNull(directiveProposal.resolvedAt))
    .groupBy(directiveProposal.organizationId);
  return new Map(rows.map((r) => [r.organizationId, Number(r.n)]));
}

/**
 * Resolve one proposal on the caller's transaction (+ the ledger entry on the
 * raising vendor). The `isNull(resolvedAt)` guard makes resolution first-write
 * -wins: a concurrent resolver updates zero rows and returns false.
 */
export async function resolveProposalTx(
  tx: Executor,
  input: {
    proposalId: number;
    resolution: "APPROVED" | "REJECTED" | "SUPERSEDED";
    resolvedByUserId: string | null;
    resolutionNote?: string | null;
    appliedPolicyId?: number | null;
  },
): Promise<DirectiveProposalRow | null> {
  const [row] = await tx
    .update(directiveProposal)
    .set({
      resolvedAt: new Date(),
      resolution: input.resolution,
      resolvedByUserId: input.resolvedByUserId,
      resolutionNote: input.resolutionNote ?? null,
      appliedPolicyId: input.appliedPolicyId ?? null,
    })
    .where(
      and(
        eq(directiveProposal.id, input.proposalId),
        isNull(directiveProposal.resolvedAt),
      ),
    )
    .returning();
  if (!row) return null;
  if (row.vendorId !== null) {
    await tx.insert(vendorActivity).values({
      vendorId: row.vendorId,
      organizationId: row.organizationId,
      type: "DIRECTIVE_PROPOSAL_RESOLVED",
      actorUserId: input.resolvedByUserId,
      metadata: {
        proposalUuid: row.uuid,
        resolution: input.resolution,
        noteLen: input.resolutionNote?.length ?? 0,
      },
    });
  }
  return row;
}

/**
 * Supersede every other OPEN proposal of the org (their base just moved —
 * §24.4). Called inside the approval transaction, after the winner resolved.
 */
export async function supersedeOpenProposalsForOrgTx(
  tx: Executor,
  organizationId: number,
  exceptProposalId: number,
): Promise<number> {
  const rows = await tx
    .update(directiveProposal)
    .set({
      resolvedAt: new Date(),
      resolution: "SUPERSEDED",
      resolutionNote:
        "La política activa cambió antes de la revisión; vuelva a proponer sobre la versión vigente.",
    })
    .where(
      and(
        eq(directiveProposal.organizationId, organizationId),
        isNull(directiveProposal.resolvedAt),
        ne(directiveProposal.id, exceptProposalId),
      ),
    )
    .returning({
      id: directiveProposal.id,
      uuid: directiveProposal.uuid,
      vendorId: directiveProposal.vendorId,
    });
  for (const row of rows) {
    if (row.vendorId === null) continue;
    await tx.insert(vendorActivity).values({
      vendorId: row.vendorId,
      organizationId,
      type: "DIRECTIVE_PROPOSAL_RESOLVED",
      metadata: { proposalUuid: row.uuid, resolution: "SUPERSEDED" },
    });
  }
  return rows.length;
}
