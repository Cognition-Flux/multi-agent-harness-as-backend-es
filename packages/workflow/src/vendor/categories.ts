/**
 * The 11 Vendra requirement categories (SPEC §3.1) — the compliance
 * dimensions every downstream engine keys on.
 */

export const RequirementCategory = {
  TAX_IDENTITY: "TAX_IDENTITY",
  INSURANCE_GENERAL_LIABILITY: "INSURANCE_GENERAL_LIABILITY",
  INSURANCE_WORKERS_COMP: "INSURANCE_WORKERS_COMP",
  INSURANCE_AUTO: "INSURANCE_AUTO",
  BUSINESS_LICENSE: "BUSINESS_LICENSE",
  DIVERSITY_CERTIFICATION: "DIVERSITY_CERTIFICATION",
  SAFETY_RECORD: "SAFETY_RECORD",
  BANKING_VERIFICATION: "BANKING_VERIFICATION",
  DATA_SECURITY: "DATA_SECURITY",
  SIGNED_AGREEMENTS: "SIGNED_AGREEMENTS",
  SANCTIONS_SCREENING: "SANCTIONS_SCREENING",
} as const;

export type RequirementCategoryType =
  (typeof RequirementCategory)[keyof typeof RequirementCategory];

export const REQUIREMENT_CATEGORY_VALUES = Object.values(
  RequirementCategory,
) as [RequirementCategoryType, ...RequirementCategoryType[]];

export const REQUIREMENT_CATEGORY_LABELS: Record<
  RequirementCategoryType,
  string
> = {
  TAX_IDENTITY: "Tax identity",
  INSURANCE_GENERAL_LIABILITY: "General liability insurance",
  INSURANCE_WORKERS_COMP: "Workers' compensation insurance",
  INSURANCE_AUTO: "Commercial auto insurance",
  BUSINESS_LICENSE: "Business license",
  DIVERSITY_CERTIFICATION: "Diversity certification",
  SAFETY_RECORD: "Safety record",
  BANKING_VERIFICATION: "Banking verification",
  DATA_SECURITY: "Data security attestation",
  SIGNED_AGREEMENTS: "Signed agreements",
  SANCTIONS_SCREENING: "Sanctions screening",
};

export function requirementCategoryLabel(category: string): string {
  return (
    REQUIREMENT_CATEGORY_LABELS[category as RequirementCategoryType] ??
    category.replaceAll("_", " ").toLowerCase()
  );
}

/**
 * The determination-authority set: categories for which per-document
 * extraction grants are NEVER the effective grant — the
 * coverage-determination lane's verdict is. Drives the manual-grant
 * already-satisfied exemption (§8.3) and the recompute fold (§6.7).
 */
export const COVERAGE_DETERMINATION_CATEGORIES: readonly RequirementCategoryType[] =
  [
    RequirementCategory.INSURANCE_GENERAL_LIABILITY,
    RequirementCategory.INSURANCE_WORKERS_COMP,
    RequirementCategory.INSURANCE_AUTO,
  ];

/**
 * Categories a coverage-scoped grant can feed: a name-mismatched
 * parent-company policy can still contribute here — never to e.g.
 * TAX_IDENTITY.
 */
export const COVERAGE_GOVERNED_CATEGORIES: readonly RequirementCategoryType[] =
  COVERAGE_DETERMINATION_CATEGORIES;

export function isCoverageDeterminationCategory(
  category: string,
): category is RequirementCategoryType {
  return (COVERAGE_DETERMINATION_CATEGORIES as readonly string[]).includes(
    category,
  );
}
