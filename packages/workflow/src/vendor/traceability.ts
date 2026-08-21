/**
 * The single requirement-evidence derivation (SPEC §6.7/§8.2) shared by
 * the recompute engine, the Requirement Traceability projection, the vendor
 * portal category list, and the expiry sweep — one derivation, zero drift.
 *
 * Single-authority invariant: the coverage-determination categories fold
 * from the determination verdict ONLY — per-document extraction grants
 * never green them anywhere. Manual grants and waiver cascades still reach
 * them (the officer's rescue path).
 */
import {
  isCoverageDeterminationCategory,
  REQUIREMENT_CATEGORY_VALUES,
  type RequirementCategoryType,
  requirementCategoryLabel,
} from "./categories";
import {
  type CoverageDeterminationRecord,
  LINE_TO_REQUIREMENT_CATEGORY,
} from "./coverage-determination";
import { getPotentialRequirementsForDocumentType } from "./requirements";
import type { GrantSource } from "./requirement-profile";
import type { VendorDocumentType } from "./schemas";

// =============================================================================
// Inputs
// =============================================================================

export interface EvidenceDocInput {
  documentUuid: string;
  uploadStatus:
    | "PENDING"
    | "UPLOADING"
    | "UPLOADED"
    | "PROCESSING"
    | "PROCESSED"
    | "FAILED"
    | "ERROR";
  documentType: string | null;
  /** Latest-extraction requirementsGranted (contributing for coverage cats). */
  requirementsGranted: string[];
  /** Coverage-scoped categories on a FAILED doc (name-mismatch-only path). */
  scopedCategories: string[];
  /** Latest-extraction validation verdict (informational to consumers). */
  validationValid?: boolean | null;
  /** Active waiver on the latest extraction, when any. */
  waiver: {
    active: boolean;
    scopedCategories: string[];
    expiresAt: string | null;
  } | null;
  /** ACTIVE manual grants on this document. */
  manualGrantCategories: string[];
  extractedExpirationDate: string | null;
}

export interface ApiCheckInput {
  category: string;
  provider: string;
  passed: boolean;
  checkedAt: string;
  expiresAt: string | null;
}

export interface RequirementEvidenceInput {
  docs: EvidenceDocInput[];
  determination: CoverageDeterminationRecord | null;
  determinationFresh: boolean;
  apiChecks: ApiCheckInput[];
  now: Date;
  /**
   * The governance referee boundary (SPEC §19.4). Categories the AUTOMATED
   * pipeline may keep settling; anything else that an automated source would
   * grant is withheld and marked `referred` for an officer.
   *
   * Optional and defaulting to "everything" so pre-governance callers — and a
   * vendor whose org has no policy yet — fold exactly as they always did.
   */
  refereeableCategories?: readonly RequirementCategoryType[];
  /**
   * The vendor profile's required categories. Only a REQUIRED category can gate
   * activation, so only those are ever withheld — referring anything else would
   * queue a question whose answer changes nothing.
   */
  requiredCategories?: readonly RequirementCategoryType[];
}

// =============================================================================
// Output
// =============================================================================

export interface CategoryEvidence {
  category: RequirementCategoryType;
  label: string;
  granted: boolean;
  /** Coverage categories only: the lane has not converged on current inputs. */
  determining: boolean;
  /**
   * An automated source proved this category, but policy withholds ratification
   * (SPEC §19.4) — an officer must decide. NOT the same as ungranted-for-lack-of-
   * evidence, and mutually exclusive with both `granted` and `determining`.
   */
  referred: boolean;
  /**
   * Evidence an automated source produced that policy WITHHELD (§19.4). Kept
   * out of `sources` deliberately: `sources` is what counts, and the activation
   * gate is derived from it — a withheld source in there would clear the very
   * gate the referral exists to hold. This array is what an officer ratifies.
   */
  referredSources: GrantSource[];
  sources: GrantSource[];
  grantingDocumentUuids: string[];
  /** Granting docs whose own expiration has lapsed (yellow-cascade rollup). */
  expiredGrantingDocumentUuids: string[];
  /** Coverage-contributing docs (extraction grants + scoped acceptances). */
  contributingDocumentUuids: string[];
  failedDocumentUuids: string[];
  processingDocumentUuids: string[];
  pendingDocumentUuids: string[];
  /** Earliest lapse among currently-granting sources (ISO date), if any. */
  expiresAt: string | null;
}

export interface RequirementEvidenceResult {
  byCategory: Map<RequirementCategoryType, CategoryEvidence>;
  granted: Map<RequirementCategoryType, GrantSource[]>;
  /** Docs with no classification yet (traceability "unclassified" bucket). */
  unclassifiedDocumentUuids: string[];
  /** Earliest lapse across every granting source — the roster/sweep denorm. */
  nextExpiryAt: string | null;
}

function isExpired(isoDate: string | null, now: Date): boolean {
  if (!isoDate) return false;
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getTime() <= now.getTime();
}

function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

// =============================================================================
// The derivation
// =============================================================================

export function deriveRequirementEvidence(
  input: RequirementEvidenceInput,
): RequirementEvidenceResult {
  const { docs, determination, determinationFresh, apiChecks, now } = input;

  const byCategory = new Map<RequirementCategoryType, CategoryEvidence>();
  for (const category of REQUIREMENT_CATEGORY_VALUES) {
    byCategory.set(category, {
      category,
      label: requirementCategoryLabel(category),
      granted: false,
      determining: false,
      referred: false,
      referredSources: [],
      sources: [],
      grantingDocumentUuids: [],
      expiredGrantingDocumentUuids: [],
      contributingDocumentUuids: [],
      failedDocumentUuids: [],
      processingDocumentUuids: [],
      pendingDocumentUuids: [],
      expiresAt: null,
    });
  }
  const unclassifiedDocumentUuids: string[] = [];

  // SPEC §19.4. `undefined` means "no policy" and therefore full autonomy, which
  // is what every caller did before the governance layer existed.
  const refereeable = input.refereeableCategories
    ? new Set<string>(input.refereeableCategories)
    : null;
  const required = new Set<string>(input.requiredCategories ?? []);

  /**
   * Is this grant the automated pipeline settling a category policy says a human
   * must settle? Officer sources (`manual_grant`, `waiver`) are the human
   * decision itself and are never withheld — withholding them would make the
   * officer's rescue path unreachable.
   */
  const withheldByPolicy = (
    category: RequirementCategoryType,
    kind: GrantSource["kind"],
  ): boolean => {
    if (!refereeable) return false;
    if (kind === "manual_grant" || kind === "waiver") return false;
    return required.has(category) && !refereeable.has(category);
  };

  const addSource = (
    category: RequirementCategoryType,
    source: GrantSource,
  ): void => {
    const entry = byCategory.get(category);
    if (!entry) return;
    if (withheldByPolicy(category, source.kind)) {
      // Recorded, but NOT in `sources` — see the note on `referredSources`.
      entry.referredSources.push(source);
      entry.referred = true;
      return;
    }
    entry.sources.push(source);
    entry.granted = true;
    if (source.expiresAt) {
      entry.expiresAt = minIso(entry.expiresAt, source.expiresAt);
    }
  };

  for (const doc of docs) {
    const potential = doc.documentType
      ? getPotentialRequirementsForDocumentType(
          doc.documentType as VendorDocumentType,
        )
      : [];

    // Manual grants apply regardless of the doc's pipeline status — an
    // officer's grant is never invisible.
    for (const category of doc.manualGrantCategories) {
      if ((REQUIREMENT_CATEGORY_VALUES as readonly string[]).includes(category)) {
        addSource(category as RequirementCategoryType, {
          kind: "manual_grant",
          documentUuid: doc.documentUuid,
          expiresAt: null,
        });
      }
    }

    // Active unexpired waivers grant their scoped categories.
    if (doc.waiver?.active) {
      const waiverExpired = isExpired(doc.waiver.expiresAt, now);
      for (const category of doc.waiver.scopedCategories) {
        if (!(REQUIREMENT_CATEGORY_VALUES as readonly string[]).includes(category)) {
          continue;
        }
        if (!waiverExpired) {
          addSource(category as RequirementCategoryType, {
            kind: "waiver",
            documentUuid: doc.documentUuid,
            expiresAt: doc.waiver.expiresAt,
          });
        } else {
          // A lapsed waiver stops granting — surfaces render it expired.
          const entry = byCategory.get(category as RequirementCategoryType);
          entry?.expiredGrantingDocumentUuids.push(doc.documentUuid);
        }
      }
    }

    switch (doc.uploadStatus) {
      case "PROCESSED": {
        const docExpired = isExpired(doc.extractedExpirationDate, now);
        for (const category of doc.requirementsGranted) {
          if (!(REQUIREMENT_CATEGORY_VALUES as readonly string[]).includes(category)) {
            continue;
          }
          const cat = category as RequirementCategoryType;
          const entry = byCategory.get(cat);
          if (!entry) continue;
          if (isCoverageDeterminationCategory(cat)) {
            // Contributing only — the determination is the authority.
            entry.contributingDocumentUuids.push(doc.documentUuid);
            continue;
          }
          if (docExpired) {
            entry.expiredGrantingDocumentUuids.push(doc.documentUuid);
            continue;
          }
          entry.grantingDocumentUuids.push(doc.documentUuid);
          addSource(cat, {
            kind: "document",
            documentUuid: doc.documentUuid,
            expiresAt: doc.extractedExpirationDate,
          });
        }
        break;
      }
      case "FAILED":
      case "ERROR": {
        for (const category of doc.scopedCategories) {
          const entry = byCategory.get(category as RequirementCategoryType);
          entry?.contributingDocumentUuids.push(doc.documentUuid);
        }
        if (doc.scopedCategories.length === 0) {
          if (potential.length === 0) {
            unclassifiedDocumentUuids.push(doc.documentUuid);
          }
          for (const category of potential) {
            byCategory.get(category)?.failedDocumentUuids.push(doc.documentUuid);
          }
        }
        break;
      }
      case "PROCESSING":
      case "UPLOADED": {
        if (potential.length === 0) {
          unclassifiedDocumentUuids.push(doc.documentUuid);
        }
        for (const category of potential) {
          byCategory.get(category)?.processingDocumentUuids.push(doc.documentUuid);
        }
        break;
      }
      case "PENDING":
      case "UPLOADING": {
        if (potential.length === 0) {
          unclassifiedDocumentUuids.push(doc.documentUuid);
        }
        for (const category of potential) {
          byCategory.get(category)?.pendingDocumentUuids.push(doc.documentUuid);
        }
        break;
      }
    }
  }

  // Coverage authority: a FRESH determination's MEETS lines grant their
  // categories; anything else leaves them ungrated (and possibly determining).
  if (determination && determinationFresh) {
    for (const line of determination.lines) {
      if (line.verdict !== "MEETS") continue;
      const category = LINE_TO_REQUIREMENT_CATEGORY[line.category];
      const entry = byCategory.get(category);
      if (!entry) continue;
      // The determination's grant lapses when its earliest contributing
      // document lapses — that's what re-enters the sweep.
      let earliest: string | null = null;
      for (const contribution of line.contributions) {
        if (contribution.role === "rejected") continue;
        const doc = docs.find((d) => d.documentUuid === contribution.documentUuid);
        if (doc?.extractedExpirationDate) {
          earliest = minIso(earliest, doc.extractedExpirationDate);
        }
      }
      if (earliest && isExpired(earliest, now)) {
        entry.expiredGrantingDocumentUuids.push(
          ...line.contributions
            .filter((c) => c.role !== "rejected")
            .map((c) => c.documentUuid),
        );
        continue;
      }
      addSource(category, { kind: "determination", expiresAt: earliest });
      entry.grantingDocumentUuids.push(
        ...line.contributions
          .filter((c) => c.role !== "rejected")
          .map((c) => c.documentUuid),
      );
    }
  }

  // Determining flags: a coverage category with live evidence but no fresh
  // converged verdict shows "determining", never a stale figure as truth.
  for (const category of REQUIREMENT_CATEGORY_VALUES) {
    if (!isCoverageDeterminationCategory(category)) continue;
    const entry = byCategory.get(category);
    if (!entry || entry.granted) continue;
    entry.determining =
      !determinationFresh &&
      (entry.contributingDocumentUuids.length > 0 ||
        entry.processingDocumentUuids.length > 0);
  }

  // API-check evidence (SANCTIONS_SCREENING et al.) renders identically to
  // documents (§6.9). NB this runs AFTER the determining pass, so the
  // exclusivity fixup below is what keeps the three flags coherent.
  for (const check of apiChecks) {
    if (!(REQUIREMENT_CATEGORY_VALUES as readonly string[]).includes(check.category)) {
      continue;
    }
    if (check.passed && !isExpired(check.expiresAt, now)) {
      addSource(check.category as RequirementCategoryType, {
        kind: "api_check",
        expiresAt: check.expiresAt,
      });
    }
  }

  // Flag coherence (§19.4): the three states are mutually exclusive. A category
  // an officer has since granted is no longer pending, and a withheld coverage
  // category must not also advertise "determining" — the bug this fold replaced
  // rendered both at once.
  for (const entry of byCategory.values()) {
    if (entry.granted) entry.referred = false;
    if (entry.referred) entry.determining = false;
  }

  const granted = new Map<RequirementCategoryType, GrantSource[]>();
  let nextExpiryAt: string | null = null;
  for (const [category, entry] of byCategory) {
    if (entry.sources.length > 0) {
      granted.set(category, entry.sources);
    }
    if (entry.granted && entry.expiresAt) {
      nextExpiryAt = minIso(nextExpiryAt, entry.expiresAt);
    }
  }

  return { byCategory, granted, unclassifiedDocumentUuids, nextExpiryAt };
}
