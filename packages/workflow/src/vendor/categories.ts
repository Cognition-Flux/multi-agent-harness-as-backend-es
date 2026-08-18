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
  TAX_IDENTITY: "Identidad fiscal",
  INSURANCE_GENERAL_LIABILITY: "Seguro de responsabilidad civil general",
  INSURANCE_WORKERS_COMP: "Seguro de compensación laboral",
  INSURANCE_AUTO: "Seguro de auto comercial",
  BUSINESS_LICENSE: "Licencia comercial",
  DIVERSITY_CERTIFICATION: "Certificación de diversidad",
  SAFETY_RECORD: "Historial de seguridad",
  BANKING_VERIFICATION: "Verificación bancaria",
  DATA_SECURITY: "Atestación de seguridad de datos",
  SIGNED_AGREEMENTS: "Acuerdos firmados",
  SANCTIONS_SCREENING: "Verificación de sanciones",
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
