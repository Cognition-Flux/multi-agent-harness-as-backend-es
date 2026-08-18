/**
 * Requirement-profile row → pure-engine shapes (profiles are DATA per org,
 * SPEC §6.10 / R5).
 */
import type { schema } from "@vendra/db-vendor";
import {
  DEFAULT_THRESHOLDS,
  REQUIREMENT_CATEGORY_VALUES,
  type RequirementCategoryType,
  type RequirementProfile,
  type RequirementThresholds,
  type VendorWorkProfile,
} from "@vendra/workflow/vendor";

export type ProfileRow = typeof schema.vendorRequirementProfile.$inferSelect;

function asCategories(values: readonly string[] | null): RequirementCategoryType[] {
  return (values ?? []).filter((v): v is RequirementCategoryType =>
    (REQUIREMENT_CATEGORY_VALUES as readonly string[]).includes(v),
  );
}

export function toRequirementProfile(row: ProfileRow): RequirementProfile {
  return {
    required: asCategories(row.required),
    mandatory: asCategories(row.mandatory),
    dismissible: asCategories(row.dismissible),
    maxManualDismissable: row.maxManualDismissable,
  };
}

export function toThresholds(row: ProfileRow): RequirementThresholds {
  const raw = (row.thresholds ?? {}) as Record<string, unknown>;
  const num = (key: string, fallback: number): number =>
    typeof raw[key] === "number" ? (raw[key] as number) : fallback;
  const flag = (key: string, fallback: boolean): boolean =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback;
  return {
    glOccurrenceUsd: num("gl_occurrence_usd", DEFAULT_THRESHOLDS.glOccurrenceUsd),
    glAggregateUsd: num("gl_aggregate_usd", DEFAULT_THRESHOLDS.glAggregateUsd),
    autoLimitUsd: num("auto_limit_usd", DEFAULT_THRESHOLDS.autoLimitUsd),
    wcLimitUsd: num("wc_limit_usd", DEFAULT_THRESHOLDS.wcLimitUsd),
    cyberLimitUsd: num("cyber_limit_usd", DEFAULT_THRESHOLDS.cyberLimitUsd),
    emrMax: num("emr_max", DEFAULT_THRESHOLDS.emrMax),
    soc2MaxAgeMonths: num("soc2_max_age_months", DEFAULT_THRESHOLDS.soc2MaxAgeMonths),
    requireAdditionalInsured: flag(
      "require_additional_insured",
      DEFAULT_THRESHOLDS.requireAdditionalInsured,
    ),
    requireWaiverOfSubrogation: flag(
      "require_waiver_of_subrogation",
      DEFAULT_THRESHOLDS.requireWaiverOfSubrogation,
    ),
    requirePrimaryNoncontributory: flag(
      "require_primary_noncontributory",
      DEFAULT_THRESHOLDS.requirePrimaryNoncontributory,
    ),
  };
}

export function toWorkProfile(raw: unknown): VendorWorkProfile {
  if (!raw || typeof raw !== "object") return {};
  const w = raw as Record<string, unknown>;
  return {
    remoteOnly: w.remoteOnly === true,
    onSite: w.onSite === true,
    states: Array.isArray(w.states)
      ? (w.states as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
    foreignEntity: w.foreignEntity === true,
  };
}
