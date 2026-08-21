/**
 * The vendor-facing compliance summary (SPEC §7.4) — one serializer over
 * `loadVendorEvidence` shared by the summary poll route and the portal SSR
 * bootstrap, so live and reloaded state can never disagree.
 *
 * Truthfulness: while re-determining, the last CONVERGED determination is
 * served marked `stale` (the readout keeps figures under an "updating"
 * shimmer); determining with no prior figures renders the recalculating
 * skeleton (`summarySource: "none"`).
 */
import { getDb } from "@vendra/db-vendor";
import {
  requiredOccurrenceLimit,
  type CoverageDeterminationRecord,
  type RequirementCategoryType,
} from "@vendra/workflow/vendor";

import { loadVendorEvidence } from "@/server/recompute";
import { toRequirementProfile, toThresholds, toWorkProfile } from "@/server/profile";

export type CategoryState =
  | "COMPLETED"
  | "PARTIALLY_COMPLETE"
  | "DETERMINING"
  /**
   * The pipeline proved it, but company policy withholds ratification and an
   * officer must decide (SPEC §19.4). Distinct from PARTIALLY_COMPLETE, which
   * means "keep uploading" — here there is nothing the vendor can do.
   */
  | "REFERRED"
  | "DISMISSED"
  | null;

export interface SummaryCategory {
  category: RequirementCategoryType;
  label: string;
  state: CategoryState;
  granted: boolean;
  determining: boolean;
  /** Awaiting an officer's ratification (§19.4) — not the vendor's move. */
  referred: boolean;
  dismissed: boolean;
  autoDismissed: boolean;
  mandatory: boolean;
  dismissible: boolean;
  grantSources: { kind: string; documentUuid?: string; expiresAt?: string | null }[];
  grantingDocumentUuids: string[];
  contributingDocumentUuids: string[];
  failedDocumentUuids: string[];
  processingDocumentUuids: string[];
  expiredGrantingDocumentUuids: string[];
  expiresAt: string | null;
}

export interface ComplianceSummaryPayload {
  vendor: {
    uuid: string;
    legalName: string;
    dbaName: string | null;
    entityType: string | null;
    naicsCode: string | null;
    contactEmail: string | null;
    /** Masked render only — never the full TIN anywhere (§10). */
    tinLast4: string | null;
    workProfile: { remoteOnly?: boolean; onSite?: boolean; states?: string[] };
    registeredAt: string | null;
    complianceStatus: string;
  };
  profile: {
    name: string;
    required: string[];
    mandatory: string[];
    dismissible: string[];
    maxManualDismissable: number;
  };
  categories: SummaryCategory[];
  dismissedCategories: string[];
  gate: {
    cleared: boolean;
    blocking: string[];
    missingMandatory: string[];
    dismissed: string[];
  };
  coverage: {
    summarySource: "fresh" | "stale" | "none";
    determining: boolean;
    lines: CoverageDeterminationRecord["lines"] | null;
    narrative: string | null;
    conflicts: string[];
    determinedAt: string | null;
    requiredLimits: Record<string, number>;
  };
  nextExpiryAt: string | null;
}

export async function buildComplianceSummary(
  vendorId: number,
): Promise<ComplianceSummaryPayload> {
  const now = new Date();
  const loaded = await loadVendorEvidence(getDb(), vendorId, now);
  const { vendorRow, profileRow, evidence, gate, determination, determinationFresh } =
    loaded;
  const profile = toRequirementProfile(profileRow);
  const thresholds = toThresholds(profileRow);
  const workProfile = toWorkProfile(vendorRow.workProfile);

  const dismissedSet = new Set(gate.dismissed);
  const honoredManualSet = new Set(gate.honoredManual);

  const categories: SummaryCategory[] = profile.required.map((category) => {
    const entry = evidence.byCategory.get(category);
    const dismissed = dismissedSet.has(category);
    const autoDismissed = dismissed && !honoredManualSet.has(category);
    let state: CategoryState = null;
    if (dismissed) state = "DISMISSED";
    else if (entry?.granted) state = "COMPLETED";
    else if (entry?.referred) state = "REFERRED";
    else if (entry?.determining) state = "DETERMINING";
    else if (
      entry &&
      (entry.contributingDocumentUuids.length > 0 ||
        entry.failedDocumentUuids.length > 0 ||
        entry.expiredGrantingDocumentUuids.length > 0 ||
        entry.processingDocumentUuids.length > 0)
    ) {
      state = "PARTIALLY_COMPLETE";
    }
    return {
      category,
      label: entry?.label ?? category,
      state,
      granted: entry?.granted ?? false,
      determining: entry?.determining ?? false,
      referred: entry?.referred ?? false,
      dismissed,
      autoDismissed,
      mandatory: profile.mandatory.includes(category),
      dismissible: profile.dismissible.includes(category),
      grantSources: (entry?.sources ?? []).map((s) => ({
        kind: s.kind,
        ...(s.documentUuid ? { documentUuid: s.documentUuid } : {}),
        expiresAt: s.expiresAt ?? null,
      })),
      grantingDocumentUuids: entry?.grantingDocumentUuids ?? [],
      contributingDocumentUuids: entry?.contributingDocumentUuids ?? [],
      failedDocumentUuids: entry?.failedDocumentUuids ?? [],
      processingDocumentUuids: entry?.processingDocumentUuids ?? [],
      expiredGrantingDocumentUuids: entry?.expiredGrantingDocumentUuids ?? [],
      expiresAt: entry?.expiresAt ?? null,
    };
  });

  const determining = categories.some((c) => c.determining);

  return {
    vendor: {
      uuid: vendorRow.uuid,
      legalName: vendorRow.legalName,
      dbaName: vendorRow.dbaName,
      entityType: vendorRow.entityType,
      naicsCode: vendorRow.naicsCode,
      contactEmail: vendorRow.contactEmail,
      tinLast4: vendorRow.tinLast4,
      workProfile,
      registeredAt: vendorRow.registeredAt?.toISOString() ?? null,
      complianceStatus: vendorRow.complianceStatus,
    },
    profile: {
      name: profileRow.name,
      required: profile.required,
      mandatory: profile.mandatory,
      dismissible: profile.dismissible,
      maxManualDismissable: profile.maxManualDismissable,
    },
    categories,
    dismissedCategories: vendorRow.dismissedCategories ?? [],
    gate: {
      cleared: gate.cleared,
      blocking: gate.blocking,
      missingMandatory: gate.missingMandatory,
      dismissed: gate.dismissed,
    },
    coverage: {
      summarySource: determinationFresh ? "fresh" : determination ? "stale" : "none",
      determining,
      lines: determination?.lines ?? null,
      narrative: determination?.narrative ?? null,
      conflicts: determination?.conflicts ?? [],
      determinedAt: determination?.determinedAt ?? null,
      requiredLimits: {
        GENERAL_LIABILITY: requiredOccurrenceLimit("GENERAL_LIABILITY", thresholds),
        WORKERS_COMP: requiredOccurrenceLimit("WORKERS_COMP", thresholds),
        AUTO: requiredOccurrenceLimit("AUTO", thresholds),
      },
    },
    nextExpiryAt: evidence.nextExpiryAt,
  };
}
