/**
 * Document → requirement-category mapping + per-document requirement
 * verification (SPEC §6.5), plus the scoped-grant machinery (coverage-scoped
 * acceptance and the B-1 waiver-cascade narrowing).
 */
import {
  COVERAGE_GOVERNED_CATEGORIES,
  RequirementCategory,
  type RequirementCategoryType,
  REQUIREMENT_CATEGORY_VALUES,
  requirementCategoryLabel,
} from "./categories";
import type { ValidationResult, ValidationRule } from "./validators";
import { parseIsoDate, readCoverageLines } from "./validators";
import {
  type CoverageLine,
  type VendorDocumentType,
  VendorDocumentTypeEnum,
} from "./schemas";

// =============================================================================
// The map
// =============================================================================

export const VENDOR_REQUIREMENT_MAP: Record<
  VendorDocumentType,
  RequirementCategoryType[]
> = {
  ACORD_25_COI: [
    RequirementCategory.INSURANCE_GENERAL_LIABILITY,
    RequirementCategory.INSURANCE_WORKERS_COMP,
    RequirementCategory.INSURANCE_AUTO,
  ],
  INSURANCE_POLICY_DEC_PAGE: [
    RequirementCategory.INSURANCE_GENERAL_LIABILITY,
    RequirementCategory.INSURANCE_WORKERS_COMP,
    RequirementCategory.INSURANCE_AUTO,
  ],
  UMBRELLA_POLICY: [
    RequirementCategory.INSURANCE_GENERAL_LIABILITY,
    RequirementCategory.INSURANCE_AUTO,
  ],
  W9: [RequirementCategory.TAX_IDENTITY],
  W8_BEN_E: [RequirementCategory.TAX_IDENTITY],
  BUSINESS_LICENSE: [RequirementCategory.BUSINESS_LICENSE],
  DIVERSITY_CERT: [RequirementCategory.DIVERSITY_CERTIFICATION],
  EMR_LETTER: [RequirementCategory.SAFETY_RECORD],
  OSHA_300A: [RequirementCategory.SAFETY_RECORD],
  SOC2_REPORT: [RequirementCategory.DATA_SECURITY],
  ISO_27001_CERT: [RequirementCategory.DATA_SECURITY],
  CYBER_POLICY: [RequirementCategory.DATA_SECURITY],
  BANK_LETTER: [RequirementCategory.BANKING_VERIFICATION],
  VOID_CHECK: [RequirementCategory.BANKING_VERIFICATION],
  MSA_SIGNED: [RequirementCategory.SIGNED_AGREEMENTS],
  NDA_SIGNED: [RequirementCategory.SIGNED_AGREEMENTS],
  UNKNOWN: [],
};

/** Every category this document type can ever satisfy (map lookup). */
export function getPotentialRequirementsForDocumentType(
  documentType: VendorDocumentType,
): RequirementCategoryType[] {
  return VENDOR_REQUIREMENT_MAP[documentType] ?? [];
}

const INSURANCE_DOC_TYPES: readonly VendorDocumentType[] = [
  VendorDocumentTypeEnum.ACORD_25_COI,
  VendorDocumentTypeEnum.INSURANCE_POLICY_DEC_PAGE,
  VendorDocumentTypeEnum.UMBRELLA_POLICY,
];

export function isInsuranceDocumentType(
  documentType: VendorDocumentType,
): boolean {
  return INSURANCE_DOC_TYPES.includes(documentType);
}

const LINE_TO_CATEGORY: Partial<Record<CoverageLine, RequirementCategoryType>> =
  {
    GENERAL_LIABILITY: RequirementCategory.INSURANCE_GENERAL_LIABILITY,
    WORKERS_COMP: RequirementCategory.INSURANCE_WORKERS_COMP,
    AUTO: RequirementCategory.INSURANCE_AUTO,
    CYBER: RequirementCategory.DATA_SECURITY,
  };

export function coverageLineCategory(
  line: CoverageLine,
): RequirementCategoryType | null {
  return LINE_TO_CATEGORY[line] ?? null;
}

/**
 * The classification allowlist for a requirement profile: every catalog type
 * that can satisfy at least one required category (the inference rule — a
 * type is accepted when the profile accepts a category it evidences).
 * UNKNOWN is always allowed as the first-class "not one of these" terminal.
 */
export function deriveAllowedDocumentTypes(
  requiredCategories: readonly string[],
): Set<VendorDocumentType> {
  const required = new Set(requiredCategories);
  const allowed = new Set<VendorDocumentType>([VendorDocumentTypeEnum.UNKNOWN]);
  for (const [type, categories] of Object.entries(VENDOR_REQUIREMENT_MAP)) {
    if (categories.some((category) => required.has(category))) {
      allowed.add(type as VendorDocumentType);
    }
  }
  return allowed;
}

// =============================================================================
// Per-document requirement verification
// =============================================================================

export interface RequirementVerificationEntry {
  category: RequirementCategoryType;
  label: string;
  granted: boolean;
  message: string;
}

export interface RequirementVerificationResult {
  /**
   * The categories this document's evidence supports. NB for the
   * coverage-determination categories these are CONTRIBUTING records — the
   * effective grant is always the coverage lane's verdict (§6.6/§6.7).
   */
  satisfiedCategories: RequirementCategoryType[];
  results: RequirementVerificationEntry[];
}

function lineInForce(
  effective: string | null,
  expiration: string | null,
  now: Date,
): boolean {
  const exp = parseIsoDate(expiration);
  if (!exp || exp.getTime() <= now.getTime()) return false;
  const eff = parseIsoDate(effective);
  return !eff || eff.getTime() <= now.getTime();
}

/**
 * Which categories does THIS document satisfy? Map lookup + per-type
 * evaluation. UNKNOWN → empty result. Requires a passing validation —
 * callers on the failed path use `evaluateCoverageScopedGrant` instead.
 */
export function verifyRequirements(
  documentType: VendorDocumentType,
  extractedData: Record<string, unknown>,
  validationResult: ValidationResult | null,
  referenceDate?: Date,
): RequirementVerificationResult {
  const now = referenceDate ?? new Date();
  const potential = getPotentialRequirementsForDocumentType(documentType);
  if (potential.length === 0 || !validationResult?.valid) {
    return { satisfiedCategories: [], results: [] };
  }

  const granted = new Set<RequirementCategoryType>();
  const results: RequirementVerificationEntry[] = [];
  const grant = (category: RequirementCategoryType, message: string) => {
    if (!granted.has(category)) {
      granted.add(category);
      results.push({
        category,
        label: requirementCategoryLabel(category),
        granted: true,
        message,
      });
    }
  };

  switch (documentType) {
    case VendorDocumentTypeEnum.ACORD_25_COI: {
      for (const line of readCoverageLines(extractedData)) {
        if (!lineInForce(line.effective_date, line.expiration_date, now)) continue;
        if (line.line === "UMBRELLA") {
          grant(
            RequirementCategory.INSURANCE_GENERAL_LIABILITY,
            "An in-force umbrella line contributes to general-liability coverage.",
          );
          continue;
        }
        const category = coverageLineCategory(line.line);
        if (category) {
          grant(category, `An in-force ${line.line.replaceAll("_", " ").toLowerCase()} line is evidenced.`);
        }
      }
      break;
    }
    case VendorDocumentTypeEnum.INSURANCE_POLICY_DEC_PAGE: {
      const lineValue = extractedData.line;
      const line =
        typeof lineValue === "string" ? (lineValue as CoverageLine) : null;
      if (
        line &&
        lineInForce(
          typeof extractedData.effective_date === "string"
            ? extractedData.effective_date
            : null,
          typeof extractedData.expiration_date === "string"
            ? extractedData.expiration_date
            : null,
          now,
        )
      ) {
        const category =
          line === "UMBRELLA"
            ? RequirementCategory.INSURANCE_GENERAL_LIABILITY
            : coverageLineCategory(line);
        if (category) {
          grant(category, "An in-force policy declarations page is evidenced.");
        }
      }
      break;
    }
    case VendorDocumentTypeEnum.UMBRELLA_POLICY: {
      if (
        lineInForce(
          typeof extractedData.effective_date === "string"
            ? extractedData.effective_date
            : null,
          typeof extractedData.expiration_date === "string"
            ? extractedData.expiration_date
            : null,
          now,
        )
      ) {
        grant(
          RequirementCategory.INSURANCE_GENERAL_LIABILITY,
          "An in-force umbrella policy contributes to general-liability coverage.",
        );
      }
      break;
    }
    default: {
      // Non-insurance types: a passing validation grants every mapped category.
      for (const category of potential) {
        grant(category, "Verified by document validation.");
      }
    }
  }

  return { satisfiedCategories: [...granted], results };
}

// =============================================================================
// Coverage-scoped grant (failed-doc coverage contribution)
// =============================================================================

export interface CoverageScopedGrantResult {
  isCoverageAccepted: boolean;
  coverageCategories: RequirementCategoryType[];
}

/**
 * A FAILED insurance document whose ONLY (non-informational) failure is the
 * entity-name mismatch can still contribute to the coverage-determination
 * categories — a parent company's policy legitimately covers a subsidiary.
 * The row still FAILS (no per-document grants are persisted; read paths
 * render "Counted · coverage"), and the coverage lane sees the document as
 * a contributing input.
 */
export function evaluateCoverageScopedGrant(input: {
  documentType: VendorDocumentType;
  extractedData: Record<string, unknown>;
  validationResult: ValidationResult | null;
  referenceDate?: Date;
}): CoverageScopedGrantResult {
  const { documentType, validationResult } = input;
  if (!isInsuranceDocumentType(documentType) || !validationResult) {
    return { isCoverageAccepted: false, coverageCategories: [] };
  }
  const failures = validationResult.rules.filter(
    (r) => !r.passed && !r.informational,
  );
  if (
    failures.length === 0 ||
    !failures.every((r) => r.validatorId === "entity_name_match")
  ) {
    return { isCoverageAccepted: false, coverageCategories: [] };
  }

  // Which coverage categories does the document actually evidence? Re-run
  // the grant evaluation as-if valid, then intersect with the coverage set.
  const asIfValid: ValidationResult = { ...validationResult, valid: true };
  const verification = verifyRequirements(
    documentType,
    input.extractedData,
    asIfValid,
    input.referenceDate,
  );
  const coverageCategories = verification.satisfiedCategories.filter((c) =>
    (COVERAGE_GOVERNED_CATEGORIES as readonly string[]).includes(c),
  );
  return {
    isCoverageAccepted: coverageCategories.length > 0,
    coverageCategories,
  };
}

// =============================================================================
// Waiver-cascade scoping (the B-1 narrowing)
// =============================================================================

/**
 * Server-side narrowing of an officer waiver's scope — never UI-trusted:
 *
 * 1. Start from the categories this document could ever satisfy (the map).
 * 2. When the persisted failures are ONLY the entity-name mismatch, the
 *    failure legitimately blocks the coverage-governed categories alone —
 *    a name mismatch can never justify waiving into e.g. TAX_IDENTITY.
 * 3. Intersect with the officer's intended categories, silently dropping
 *    unknown strings.
 */
export function scopeWaiverCascadeCategories(
  potentialCategories: readonly string[],
  persistedRules: readonly ValidationRule[],
  intendedCategories: readonly string[],
): RequirementCategoryType[] {
  const potential = potentialCategories.filter((c): c is RequirementCategoryType =>
    (REQUIREMENT_CATEGORY_VALUES as readonly string[]).includes(c),
  );
  const failures = persistedRules.filter((r) => !r.passed && !r.informational);
  const nameMismatchOnly =
    failures.length > 0 &&
    failures.every((r) => r.validatorId === "entity_name_match");
  const cascade = nameMismatchOnly
    ? potential.filter((c) =>
        (COVERAGE_GOVERNED_CATEGORIES as readonly string[]).includes(c),
      )
    : potential;
  const cascadeSet = new Set<string>(cascade);
  const out: RequirementCategoryType[] = [];
  for (const intended of intendedCategories) {
    if (cascadeSet.has(intended) && !out.includes(intended as RequirementCategoryType)) {
      out.push(intended as RequirementCategoryType);
    }
  }
  return out;
}
