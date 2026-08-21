/**
 * Coverage-determination pure core (SPEC §6.6) — the persisted record
 * shape, the input-set signature, the freshness evaluator, and the host-side
 * payload validation that bounces bad tool calls back to the agent.
 *
 * The harness RUNNER lives in the app (`server/harness/coverage-runner.ts`);
 * everything here is pure math — no AI, no DB, no I/O.
 */
import { RequirementCategory, type RequirementCategoryType } from "./categories";
import type { RequirementThresholds } from "./validators";

// =============================================================================
// Shapes
// =============================================================================

export const COVERAGE_DETERMINATION_LINES = [
  "GENERAL_LIABILITY",
  "WORKERS_COMP",
  "AUTO",
] as const;
export type CoverageDeterminationLine =
  (typeof COVERAGE_DETERMINATION_LINES)[number];

export const COVERAGE_VERDICTS = ["MEETS", "BELOW", "UNDETERMINED"] as const;
export type CoverageVerdict = (typeof COVERAGE_VERDICTS)[number];

export const COVERAGE_CONTRIBUTION_ROLES = [
  "primary",
  "umbrella",
  "excess",
  "rejected",
] as const;
export type CoverageContributionRole =
  (typeof COVERAGE_CONTRIBUTION_ROLES)[number];

export interface CoverageContribution {
  documentUuid: string;
  role: CoverageContributionRole;
  amountAppliedUsd: number;
  reasoning: string;
}

export interface CoverageDeterminationLineResult {
  category: CoverageDeterminationLine;
  effectiveOccurrenceLimitUsd: number | null;
  effectiveAggregateLimitUsd: number | null;
  contributions: CoverageContribution[];
  verdict: CoverageVerdict;
  reasoning: string;
}

/** The agent's save-tool payload (already zod-parsed at the tool boundary). */
export interface SaveCoverageDeterminationInput {
  lines: CoverageDeterminationLineResult[];
  conflicts: string[];
  narrative: string;
}

/** The persisted record under compliance_status_metadata.coverage_determination. */
export interface CoverageDeterminationRecord
  extends SaveCoverageDeterminationInput {
  version: number;
  signature: string;
  determinedAt: string;
  model: string;
}

export const LINE_TO_REQUIREMENT_CATEGORY: Record<
  CoverageDeterminationLine,
  RequirementCategoryType
> = {
  GENERAL_LIABILITY: RequirementCategory.INSURANCE_GENERAL_LIABILITY,
  WORKERS_COMP: RequirementCategory.INSURANCE_WORKERS_COMP,
  AUTO: RequirementCategory.INSURANCE_AUTO,
};

export function requiredOccurrenceLimit(
  line: CoverageDeterminationLine,
  thresholds: RequirementThresholds,
): number {
  switch (line) {
    case "GENERAL_LIABILITY":
      return thresholds.glOccurrenceUsd;
    case "WORKERS_COMP":
      return thresholds.wcLimitUsd;
    case "AUTO":
      return thresholds.autoLimitUsd;
  }
}

// =============================================================================
// Signature (the policy-purge lever, §6.6)
// =============================================================================

/**
 * Bump on ANY rules change that must invalidate persisted determinations —
 * even with no input-axis change (a rules-only change otherwise leaves
 * stale persisted verdicts looking fresh).
 */
export const COVERAGE_DETERMINATION_VERSION = 2;

export interface CoverageSignatureInput {
  documentUuid: string;
  /** Latest extraction version — re-extraction changes the signature. */
  extractionVersion: number | null;
  documentType: string | null;
  uploadStatus: string;
  /** Manual coverage-grant presence — manual grants are lane inputs. */
  hasActiveCoverageManualGrant: boolean;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic input-set signature; identical inputs → identical signature. */
export function computeCoverageSignature(
  inputs: CoverageSignatureInput[],
  thresholds: RequirementThresholds,
): string {
  const canonical = JSON.stringify({
    v: COVERAGE_DETERMINATION_VERSION,
    thresholds: {
      gl: thresholds.glOccurrenceUsd,
      glAgg: thresholds.glAggregateUsd,
      auto: thresholds.autoLimitUsd,
      wc: thresholds.wcLimitUsd,
    },
    docs: inputs
      .map((d) => ({
        u: d.documentUuid,
        e: d.extractionVersion,
        t: d.documentType,
        s: d.uploadStatus,
        m: d.hasActiveCoverageManualGrant,
      }))
      .sort((a, b) => (a.u < b.u ? -1 : 1)),
  });
  return `v${COVERAGE_DETERMINATION_VERSION}-${fnv1a(canonical)}`;
}

export type CoverageFreshness = "fresh" | "stale" | "none";

export function evaluateCoverageFreshness(
  record: CoverageDeterminationRecord | null,
  currentSignature: string,
): CoverageFreshness {
  if (!record) return "none";
  return record.signature === currentSignature ? "fresh" : "stale";
}

/** Parse the persisted record off jsonb metadata (defensive). */
export function parseCoverageDetermination(
  metadata: unknown,
): CoverageDeterminationRecord | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = (metadata as Record<string, unknown>).coverage_determination;
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;
  if (typeof r.signature !== "string" || !Array.isArray(r.lines)) return null;
  return r as unknown as CoverageDeterminationRecord;
}

// =============================================================================
// Host-side payload validation (bounces bad tool calls back to the agent)
// =============================================================================

export type CoverageValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

const LIMIT_TOLERANCE = 0.01; // ±1% re-derivation agreement (§6.6)

/**
 * Sanity-check a saveCoverageDetermination payload; a rejection returns the
 * reason string so the agent can correct and retry. Enforced invariants MUST
 * also be stated in the prompt's output contract — never enforce a rule the
 * prompt did not state.
 */
export function validateCoverageDetermination(
  input: SaveCoverageDeterminationInput,
  allowedDocumentUuids: ReadonlySet<string>,
  thresholds: RequirementThresholds,
): CoverageValidationResult {
  // SPEC §18 D2. An empty payload passed every check below and then persisted
  // as a FRESH determination for the current signature: no coverage category
  // was ever granted and the lane would not re-run until an input changed.
  // The runner returns early when there are no insurance inputs, so the tool is
  // only ever reachable with something to report on.
  if (input.lines.length === 0) {
    return {
      ok: false,
      reason:
        "lines[] is empty — report one entry per coverage line you evaluated (use verdict UNDETERMINED where the evidence does not resolve).",
    };
  }

  const seenLines = new Set<string>();
  for (const line of input.lines) {
    if (seenLines.has(line.category)) {
      return { ok: false, reason: `Duplicate line for ${line.category} — report each line at most once.` };
    }
    seenLines.add(line.category);

    // UUID closure: every contribution must reference an input document.
    for (const contribution of line.contributions) {
      if (!allowedDocumentUuids.has(contribution.documentUuid)) {
        return {
          ok: false,
          reason: `contributions[].documentUuid "${contribution.documentUuid}" is not one of this vendor's input documents. Use only the document UUIDs listed in the prompt.`,
        };
      }
      // SPEC §18 D2. Nothing bounded the amount from below, so offsetting
      // entries (+2,000,000 and -1,000,000) satisfied the ±1% re-derivation
      // with arithmetic no document supports.
      if (contribution.amountAppliedUsd < 0) {
        return {
          ok: false,
          reason: `contributions[].amountAppliedUsd must be >= 0 (${contribution.documentUuid} carries ${contribution.amountAppliedUsd}). Mark a non-applying policy "rejected" with 0 rather than netting it out.`,
        };
      }
      // Role→arithmetic gate: a rejected input may not contribute dollars.
      if (contribution.role === "rejected" && contribution.amountAppliedUsd > 0) {
        return {
          ok: false,
          reason: `A "rejected" contribution (${contribution.documentUuid}) must carry amountAppliedUsd: 0 — rejected inputs never feed the aggregate.`,
        };
      }
    }

    // Policy anchor gate (a): an unresolved value is illegal on any verdict
    // that claims to know the answer — an unresolvable figure can never
    // satisfy its category, and it cannot be shown to fall short either.
    // SPEC §18 D2: the refusal copy always claimed null was UNDETERMINED-only,
    // but only MEETS was checked, so BELOW + null persisted.
    if (line.effectiveOccurrenceLimitUsd === null && line.verdict !== "UNDETERMINED") {
      return {
        ok: false,
        reason: `${line.category}: verdict ${line.verdict} requires a resolved effectiveOccurrenceLimitUsd (null is only legal with verdict UNDETERMINED).`,
      };
    }

    // Host re-derivation: effective limit must agree with the sum of the
    // non-rejected contributions within ±1%.
    if (line.effectiveOccurrenceLimitUsd !== null) {
      const contributed = line.contributions
        .filter((c) => c.role !== "rejected")
        .reduce((sum, c) => sum + c.amountAppliedUsd, 0);
      const effective = line.effectiveOccurrenceLimitUsd;
      if (contributed === 0 && effective > 0) {
        return {
          ok: false,
          reason: `${line.category}: effective limit ${effective} has no contributing documents — attribute each policy's applied amount in contributions[].`,
        };
      }
      const drift = Math.abs(contributed - effective) / Math.max(effective, 1);
      if (drift > LIMIT_TOLERANCE) {
        return {
          ok: false,
          reason: `${line.category}: contributions sum to ${contributed} but effectiveOccurrenceLimitUsd is ${effective} (drift > 1%). Make the per-document amountAppliedUsd values sum to the effective limit.`,
        };
      }
    }

    // Verdict ↔ threshold consistency — checked against BOTH the claimed
    // effective limit and the recomputed contribution sum, because assembly
    // overwrites the persisted effective with the sum (spec §16 B12): a
    // claimed 999,999 / BELOW with contributions summing 1,000,000 passes
    // the ±1% drift gate but would persist as the self-contradictory
    // "BELOW at exactly the required limit".
    const required = requiredOccurrenceLimit(line.category, thresholds);
    // SPEC §18 D2. A GL aggregate below the profile's required aggregate is a
    // legitimate reason for the line to be BELOW even when the per-occurrence
    // figure clears — without this, such a line would have NO legal verdict
    // (MEETS fails the aggregate gate, BELOW failed the B12 gate, and
    // UNDETERMINED fails the sufficiency gate) and the lane would deadlock.
    const aggregateShort =
      line.category === "GENERAL_LIABILITY" &&
      line.effectiveAggregateLimitUsd !== null &&
      line.effectiveAggregateLimitUsd < thresholds.glAggregateUsd;
    if (line.effectiveOccurrenceLimitUsd !== null) {
      const persistedEffective = line.contributions
        .filter((c) => c.role !== "rejected")
        .reduce((sum, c) => sum + c.amountAppliedUsd, 0);
      if (
        line.verdict === "MEETS" &&
        (line.effectiveOccurrenceLimitUsd < required || persistedEffective < required)
      ) {
        return {
          ok: false,
          reason: `${line.category}: verdict MEETS but the effective limit ${Math.min(line.effectiveOccurrenceLimitUsd, persistedEffective)} is below the required ${required}.`,
        };
      }
      // The §16 B12 disjunction must stay a disjunction — the persisted figure
      // is the one that lands, so either being at/above `required` is a
      // contradiction. D2 only adds the aggregate exemption on top of it.
      if (
        line.verdict === "BELOW" &&
        (line.effectiveOccurrenceLimitUsd >= required || persistedEffective >= required) &&
        !aggregateShort
      ) {
        return {
          ok: false,
          reason: `${line.category}: verdict BELOW but the contributions sum to ${persistedEffective} against the required ${required} — either mark the non-applying contributions "rejected" with amountAppliedUsd: 0, or change the verdict.`,
        };
      }
      // SPEC §18 D2. UNDETERMINED while the evidence already resolves at or
      // above the requirement is a false negative: it blocks the vendor on
      // coverage the payload itself demonstrates.
      if (line.verdict === "UNDETERMINED" && line.effectiveOccurrenceLimitUsd >= required) {
        return {
          ok: false,
          reason: `${line.category}: verdict UNDETERMINED but the effective limit ${line.effectiveOccurrenceLimitUsd} already meets the required ${required} — report ${aggregateShort ? "BELOW (the aggregate limit falls short)" : "MEETS"}, or explain the doubt by rejecting the contributions it rests on.`,
        };
      }
    }

    // SPEC §18 D2. effectiveAggregateLimitUsd was never validated: not
    // re-derived, not compared to any threshold, and free to sit below its own
    // per-occurrence figure. Contributions are attributed per occurrence, so
    // the aggregate cannot be re-derived — it is bounded instead.
    if (line.effectiveAggregateLimitUsd !== null) {
      if (
        line.effectiveOccurrenceLimitUsd !== null &&
        line.effectiveAggregateLimitUsd < line.effectiveOccurrenceLimitUsd
      ) {
        return {
          ok: false,
          reason: `${line.category}: effectiveAggregateLimitUsd ${line.effectiveAggregateLimitUsd} is below the per-occurrence limit ${line.effectiveOccurrenceLimitUsd} — an aggregate can never be the smaller figure.`,
        };
      }
      if (line.verdict === "MEETS" && aggregateShort) {
        return {
          ok: false,
          reason: `GENERAL_LIABILITY: verdict MEETS but effectiveAggregateLimitUsd ${line.effectiveAggregateLimitUsd} is below the required aggregate ${thresholds.glAggregateUsd} — report BELOW.`,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Host-authoritative assembly: the persisted per-line effective limits are
 * re-derived from contributions so the stored figures can never carry the
 * agent's arithmetic drift.
 */
export function assembleCoverageDetermination(input: {
  payload: SaveCoverageDeterminationInput;
  signature: string;
  model: string;
  now: Date;
}): CoverageDeterminationRecord {
  const lines = input.payload.lines.map((line) => {
    if (line.effectiveOccurrenceLimitUsd === null) return line;
    const contributed = line.contributions
      .filter((c) => c.role !== "rejected")
      .reduce((sum, c) => sum + c.amountAppliedUsd, 0);
    return { ...line, effectiveOccurrenceLimitUsd: contributed };
  });
  return {
    ...input.payload,
    lines,
    version: COVERAGE_DETERMINATION_VERSION,
    signature: input.signature,
    determinedAt: input.now.toISOString(),
    model: input.model,
  };
}
