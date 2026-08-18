/**
 * The activation-gate math (SPEC §6.5) — pure and `now`-injected so the
 * expiry sweep (§6.8) can evaluate it as plain math.
 *
 * Two hardening layers sit on top of the long-stable count component —
 * (1) a dismissed category never double-counts as completed, and
 * (2) the mandatory set is checked independently of any count, with the
 *     result naming the missing categories for the refusal copy.
 */
import type { RequirementCategoryType } from "./categories";

export interface RequirementProfile {
  /** Every category this profile requires. */
  required: RequirementCategoryType[];
  /** Never-dismissable core ⊆ required. */
  mandatory: RequirementCategoryType[];
  /** Vendor-toggleable "Not applicable" candidates ⊆ required. */
  dismissible: RequirementCategoryType[];
  /** Cap on honored manual dismissals. */
  maxManualDismissable: number;
}

export interface GrantSource {
  kind: "document" | "determination" | "manual_grant" | "waiver" | "api_check";
  documentUuid?: string;
  /** ISO date the grant lapses (document/waiver/api-check expiry); null = none. */
  expiresAt?: string | null;
}

export interface ActiveWaiver {
  expiresAt: Date;
}

export function hasUnexpiredGrant(
  sources: GrantSource[] | undefined,
  now: Date,
): boolean {
  if (!sources || sources.length === 0) return false;
  return sources.some((source) => {
    if (!source.expiresAt) return true;
    const expires = new Date(`${source.expiresAt.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(expires.getTime()) || expires.getTime() > now.getTime();
  });
}

export interface ActivationGateResult {
  cleared: boolean;
  /** Required, non-dismissed, unsatisfied categories. */
  blocking: RequirementCategoryType[];
  /** Mandatory categories unsatisfied — named in the refusal copy. */
  missingMandatory: RequirementCategoryType[];
  /** The manual dismissals actually honored (qualifying + under the cap). */
  honoredManual: RequirementCategoryType[];
  /** Auto + honored-manual dismissals, for display. */
  dismissed: RequirementCategoryType[];
}

export function calculateActivationGate(input: {
  profile: RequirementProfile;
  granted: Map<RequirementCategoryType, GrantSource[]>;
  waived: Map<RequirementCategoryType, ActiveWaiver>;
  manualDismissed: Set<RequirementCategoryType>;
  autoDismissed: Set<RequirementCategoryType>;
  now: Date;
}): ActivationGateResult {
  const honoredManual = [...input.manualDismissed]
    .filter(
      (c) =>
        input.profile.dismissible.includes(c) &&
        !input.profile.mandatory.includes(c),
    )
    .slice(0, input.profile.maxManualDismissable);
  const dismissed = new Set<RequirementCategoryType>([
    ...[...input.autoDismissed].filter((c) => !input.profile.mandatory.includes(c)),
    ...honoredManual,
  ]);

  const satisfied = (cat: RequirementCategoryType): boolean => {
    const waiver = input.waived.get(cat);
    if (waiver && waiver.expiresAt.getTime() > input.now.getTime()) return true;
    return hasUnexpiredGrant(input.granted.get(cat), input.now);
  };

  // A dismissed category is NEVER also counted as satisfied (no-double-credit).
  const blocking = input.profile.required.filter(
    (cat) => !dismissed.has(cat) && !satisfied(cat),
  );
  // The mandatory set is checked on its own — dismissals can never absorb it.
  const missingMandatory = input.profile.mandatory.filter(
    (cat) => !satisfied(cat),
  );

  return {
    cleared: blocking.length === 0 && missingMandatory.length === 0,
    blocking,
    missingMandatory,
    honoredManual,
    dismissed: [...dismissed],
  };
}

/**
 * Profile-conditional auto-dismissals derived from the vendor's work
 * profile: remote-only vendors don't need auto/workers'-comp;
 * DIVERSITY_CERTIFICATION is optional evidence unless the buyer's profile
 * marks it required-and-nondismissible.
 */
export interface VendorWorkProfile {
  remoteOnly?: boolean;
  onSite?: boolean;
  states?: string[];
  foreignEntity?: boolean;
}

export function deriveAutoDismissedCategories(
  profile: RequirementProfile,
  workProfile: VendorWorkProfile | null | undefined,
): Set<RequirementCategoryType> {
  const auto = new Set<RequirementCategoryType>();
  if (workProfile?.remoteOnly) {
    for (const cat of ["INSURANCE_AUTO", "INSURANCE_WORKERS_COMP"] as const) {
      if (
        profile.required.includes(cat) &&
        !profile.mandatory.includes(cat)
      ) {
        auto.add(cat);
      }
    }
  }
  return auto;
}
