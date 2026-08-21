/**
 * The per-company governance layer (SPEC §19) — pure, `now`-free, and the single
 * derivation every consumer shares (the `traceability.ts` discipline).
 *
 * Three questions, one module:
 *   1. which document types does this company accept?      `policyAllowedDocumentTypes`
 *   2. which fields/validators apply to a given document?  `resolveDocumentPolicy`
 *                                                          `applyValidatorPolicy`
 *   3. may the harness settle this category itself?         `mayHarnessReferee`
 *
 * Nothing here reads the clock or the database. The extraction-schema projection
 * lives with the schemas it projects (`SchemaRegistry.getSchema(type, fields)`).
 */
import type { RequirementCategoryType } from "./categories";
import type { VendorDocumentType } from "./schemas";
import type { ValidationResult, VendorValidatorId } from "./validators";

// =============================================================================
// Shapes (the row projections, not the rows)
// =============================================================================

/** One `company_policy_document` row. */
export interface CompanyDocumentPolicy {
  documentType: VendorDocumentType;
  /** Extraction fields the company wants. Empty = every field in the schema. */
  extractFields: string[];
  /** Validator ids whose rules COUNT for this company. Never empty (§19.5). */
  validators: VendorValidatorId[];
}

/**
 * One `company_policy` row plus its document rows. COMPANY-scoped, not
 * profile-scoped: an org may have several requirement profiles (vendor types),
 * and a document type has exactly one rule set across all of them (§19.3).
 */
export interface CompanyPolicy {
  id: number;
  version: number;
  /** Categories the harness may settle on its own; everything else is referred. */
  refereeableCategories: RequirementCategoryType[];
  documents: CompanyDocumentPolicy[];
}

// =============================================================================
// 1. The accepted document set
// =============================================================================

/**
 * The classification allowlist this policy induces. UNKNOWN is always allowed as
 * the classifier's "not one of these" terminal — the same contract
 * `deriveAllowedDocumentTypes` has always had, so the harness keeps its distinct
 * unknown-vs-not-accepted failure copy.
 */
export function policyAllowedDocumentTypes(
  policy: CompanyPolicy,
): Set<VendorDocumentType> {
  const allowed = new Set<VendorDocumentType>(["UNKNOWN"]);
  for (const doc of policy.documents) allowed.add(doc.documentType);
  return allowed;
}

export function resolveDocumentPolicy(
  policy: CompanyPolicy,
  documentType: VendorDocumentType,
): CompanyDocumentPolicy | null {
  return (
    policy.documents.find((doc) => doc.documentType === documentType) ?? null
  );
}

/**
 * What a specific vendor may upload: the company policy is an **upper bound**,
 * and the vendor's own requirement profile still scopes it.
 *
 * This is what keeps the governance layer a no-op on arrival (§19.6). Before it,
 * the allowlist was `deriveAllowedDocumentTypes(profile.required)` — derived from
 * the VENDOR's profile. A company-level set alone would widen it, because an org
 * has several profiles (a general-supplier vendor would start accepting a
 * construction-sub's safety documents). Intersecting restores the old set
 * exactly, while still letting an admin narrow it further by deselecting a type.
 */
export function effectiveAllowedDocumentTypes(
  policy: CompanyPolicy,
  profileDerivedTypes: ReadonlySet<VendorDocumentType>,
): Set<VendorDocumentType> {
  const companyAccepted = policyAllowedDocumentTypes(policy);
  const effective = new Set<VendorDocumentType>(["UNKNOWN"]);
  for (const type of companyAccepted) {
    if (type !== "UNKNOWN" && profileDerivedTypes.has(type)) effective.add(type);
  }
  return effective;
}

/**
 * Drop the fields a company's policy did not ask for (SPEC §19.1).
 *
 * Field selection is enforced at PERSIST, not only in the contract handed to the
 * agent: a model that volunteers extra fields must not have them stored, or the
 * console's "these are the fields we extract" would be false. Structural fields
 * survive regardless — `structuralExtractionFields` decides those, and the
 * admission gate refuses a policy that deselects one.
 *
 * An empty selection — or one covering every declared field — filters nothing, so
 * the default policy is a strict no-op (§19.6).
 */
export function projectExtractedData(
  extractedData: Record<string, unknown>,
  selectedFields: readonly string[],
  structuralFields: readonly string[],
  declaredFields: readonly string[],
): Record<string, unknown> {
  if (selectedFields.length === 0) return extractedData;
  // Only a NARROWING policy projects. A selection covering every declared field
  // is the behaviour-preserving default, and projecting there would still drop
  // any UNDECLARED field the model volunteered — which the coverage lane embeds
  // verbatim in its prompt, so dropping it is a behaviour change, not a tidy-up.
  const selected = new Set<string>(selectedFields);
  if (declaredFields.every((field) => selected.has(field))) return extractedData;
  const keep = new Set<string>([...selectedFields, ...structuralFields]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extractedData)) {
    if (keep.has(key)) out[key] = value;
  }
  return out;
}

// =============================================================================
// 2. Validator selection
// =============================================================================

/**
 * Narrow a validation result to the validators this company counts.
 *
 * `valid` is RECOMPUTED over the surviving non-informational rules — the
 * persisted verdict must be the policy's verdict, not the superset's — using the
 * engine's own rule (`every(passed)`) and nothing else. Keeping that rule
 * identical is what makes the behaviour-preserving default policy (every
 * validator selected) a genuine no-op (§19.6): narrowing by a superset filters
 * nothing and recomputes the same value.
 *
 * It therefore inherits the engine's vacuous truth: `[].every(...)` is `true`.
 * That is a trap for a CONFIGURED policy — a document whose counting rules were
 * all filtered away would read as PASSED. This function does not paper over it,
 * because doing so would change the no-op case too. Callers must gate on
 * `hasBlockingChecks` and fail loudly; admissibility refuses a zero-validator
 * policy at activation (§19.5) so it cannot arise from the console.
 */
export function applyValidatorPolicy(
  result: ValidationResult | null,
  allowedValidatorIds: readonly VendorValidatorId[],
): ValidationResult | null {
  if (!result) return null;
  const allowed = new Set<string>(allowedValidatorIds);
  const rules = result.rules.filter((rule) => allowed.has(rule.validatorId));
  return {
    ...result,
    rules,
    validators_array: [...new Set(rules.map((rule) => rule.validatorId))],
    valid: rules.filter((rule) => !rule.informational).every((rule) => rule.passed),
  };
}

/**
 * Did anything that can FAIL actually run? `valid: true` with no blocking rule
 * is vacuous, never a pass — the caller turns this into a hard failure with copy
 * a human can act on.
 */
export function hasBlockingChecks(result: ValidationResult | null): boolean {
  if (!result) return false;
  return result.rules.some((rule) => !rule.informational);
}

// =============================================================================
// 3. The referee boundary
// =============================================================================

/**
 * May the automated pipeline settle this category, or must a human ratify it?
 *
 * The GATE that uses this lives in `deriveRequirementEvidence` (traceability.ts),
 * not here and not at the document persist site: the fold is the single
 * authority on what is granted, and a coverage category never grants from a
 * document row at all. This predicate is the shared definition both the fold and
 * the admission gate read.
 *
 * Read the direction carefully. The automated pipeline (agent extracts → host
 * validates → host verifies requirements) has ALWAYS decided every category on
 * its own; that is the status quo, not a new power. So `refereeableCategories`
 * lists the categories where that stays true, and anything OUTSIDE the list is
 * escalated to an officer even though the pipeline reached a verdict.
 *
 * Getting this backwards inverts the whole feature: a company with an empty list
 * would refer everything and grant nothing. The behaviour-preserving default is
 * therefore every required category (§19.6), and narrowing the list is how a
 * buyer buys human oversight.
 *
 * The agent's own role is unchanged either way — it still only classifies and
 * extracts. What policy configures is who RATIFIES the host's verdict.
 */
export function mayHarnessReferee(
  policy: CompanyPolicy,
  category: RequirementCategoryType,
): boolean {
  return policy.refereeableCategories.includes(category);
}

