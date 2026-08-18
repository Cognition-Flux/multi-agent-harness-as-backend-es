/**
 * Host-side, deterministic, model-free document validation (SPEC §6.5).
 *
 * The agent decides ONLY classification + extracted values; these validators
 * decide validity. Rule/result shapes (`ValidationRule` / `ValidationResult`)
 * are load-bearing across persistence and the UI, including the B-8
 * informational semantics: informational rules MUST be `passed: true` and
 * never reject — they badge the document "WITH WARNINGS" without blocking it.
 */
import { compareEntityNames } from "./entity-names";
import type { NameMatchConfidence } from "./name-matching";
import {
  COVERAGE_LINE_VALUES,
  type CoverageLine,
  type VendorDocumentType,
  VendorDocumentTypeEnum,
} from "./schemas";

// =============================================================================
// Shapes
// =============================================================================

export type VendorValidatorId =
  | "entity_name_match"
  | "is_signed"
  | "tin_present_and_masked"
  | "limit_meets_threshold"
  | "endorsement_present"
  | "policy_in_force"
  | "emr_within_bound"
  | "report_recent"
  | "jurisdiction_match"
  | "certificate_holder_correct"
  | "expiration_valid"
  | "field_present";

export interface ValidationRule {
  validatorId: VendorValidatorId;
  rule: string;
  passed: boolean;
  message: string;
  /** B-8: informational rules are always passed:true — warning badges only. */
  informational?: boolean;
  /** The comparator confidence when the rule is an entity-name check. */
  nameMatchConfidence?: NameMatchConfidence;
}

export interface ValidationResult {
  valid: boolean;
  documentType: VendorDocumentType;
  validators_array: VendorValidatorId[];
  rules: ValidationRule[];
}

/** The vendor-registration context validators compare documents against. */
export interface VendorContext {
  legalName: string;
  dbaName?: string | null;
  tinLast4?: string | null;
  /** 2-letter state codes the vendor works in (registration work profile). */
  workStates?: string[];
  /** The buying enterprise's name (certificate-holder check). */
  buyingOrgName?: string | null;
  /**
   * HITL outcomes threaded in by finalizeDocument BEFORE validation runs:
   * a confirmed DBA_SAME_ENTITY / PARENT_POLICY_COVERS_SUBSIDIARY window
   * satisfies the entity-name rule by confirmation.
   */
  entityConfirmed?: boolean;
  /** A confirmed BLANKET_ENDORSEMENT_APPLIES window. */
  blanketEndorsementConfirmed?: boolean;
  /** A DENIED BLANKET_ENDORSEMENT_APPLIES window — unstated reads as absent. */
  blanketEndorsementDenied?: boolean;
}

/** Per-org/profile validation thresholds (requirement-profile data, §6.10). */
export interface RequirementThresholds {
  glOccurrenceUsd: number;
  glAggregateUsd: number;
  autoLimitUsd: number;
  wcLimitUsd: number;
  cyberLimitUsd: number;
  emrMax: number;
  soc2MaxAgeMonths: number;
  requireAdditionalInsured: boolean;
  requireWaiverOfSubrogation: boolean;
  requirePrimaryNoncontributory: boolean;
}

export const DEFAULT_THRESHOLDS: RequirementThresholds = {
  glOccurrenceUsd: 1_000_000,
  glAggregateUsd: 2_000_000,
  autoLimitUsd: 1_000_000,
  wcLimitUsd: 500_000,
  cyberLimitUsd: 1_000_000,
  emrMax: 1.0,
  soc2MaxAgeMonths: 12,
  requireAdditionalInsured: true,
  requireWaiverOfSubrogation: false,
  requirePrimaryNoncontributory: false,
};

export interface DocumentValidationContext {
  thresholds: RequirementThresholds;
}

// =============================================================================
// Helpers
// =============================================================================

function str(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function num(data: Record<string, unknown>, key: string): number | null {
  const v = data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(data: Record<string, unknown>, key: string): boolean | null {
  const v = data[key];
  return typeof v === "boolean" ? v : null;
}

export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function usdFmt(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

interface RuleBuilder {
  rules: ValidationRule[];
  push(rule: ValidationRule): void;
}

function makeBuilder(): RuleBuilder {
  const rules: ValidationRule[] = [];
  return {
    rules,
    push(rule) {
      rules.push(rule);
    },
  };
}

/** Entity-name rule shared by every type that carries an entity name. */
function pushEntityNameRule(
  b: RuleBuilder,
  extractedName: string | null,
  vendor: VendorContext | undefined,
  documentLabel: string,
): void {
  if (!vendor?.legalName) {
    b.push({
      validatorId: "entity_name_match",
      rule: "entity_name_match:no_vendor_on_file",
      passed: true,
      informational: true,
      message: "No registered vendor name on file — name verification was not performed.",
    });
    return;
  }
  if (vendor.entityConfirmed) {
    b.push({
      validatorId: "entity_name_match",
      rule: "entity_name_match:confirmed",
      passed: true,
      message: `The entity named on the ${documentLabel} was confirmed to be the same business.`,
      nameMatchConfidence: "clearMatch",
    });
    return;
  }
  if (!extractedName) {
    b.push({
      validatorId: "entity_name_match",
      rule: "entity_name_match:missing",
      passed: false,
      message: `The ${documentLabel} does not show a readable business name.`,
      nameMatchConfidence: "noMatch",
    });
    return;
  }
  const comparison = compareEntityNames(extractedName, {
    legalName: vendor.legalName,
    dbaName: vendor.dbaName ?? null,
  });
  if (comparison.confidence === "clearMatch") {
    b.push({
      validatorId: "entity_name_match",
      rule: "entity_name_match:match",
      passed: true,
      message: `The name on the ${documentLabel} matches the registered vendor${comparison.matchedAgainst === "dba" ? " (DBA name)" : ""}.`,
      nameMatchConfidence: comparison.confidence,
    });
    return;
  }
  b.push({
    validatorId: "entity_name_match",
    rule: "entity_name_match:mismatch",
    passed: false,
    message: `The name on the ${documentLabel} ("${extractedName}") does not match the registered vendor ("${vendor.legalName}").`,
    nameMatchConfidence: comparison.confidence,
  });
}

/** In-force rule: effective ≤ today < expiration. */
function pushInForceRule(
  b: RuleBuilder,
  effective: unknown,
  expiration: unknown,
  label: string,
  now: Date,
): void {
  const eff = parseIsoDate(effective);
  const exp = parseIsoDate(expiration);
  if (!exp) {
    b.push({
      validatorId: "policy_in_force",
      rule: `policy_in_force:${label}:no_expiration`,
      passed: false,
      message: `The ${label} shows no readable expiration date.`,
    });
    return;
  }
  if (exp.getTime() <= now.getTime()) {
    b.push({
      validatorId: "policy_in_force",
      rule: `policy_in_force:${label}:expired`,
      passed: false,
      message: `The ${label} expired on ${exp.toISOString().slice(0, 10)}.`,
    });
    return;
  }
  if (eff && eff.getTime() > now.getTime()) {
    b.push({
      validatorId: "policy_in_force",
      rule: `policy_in_force:${label}:not_yet_effective`,
      passed: false,
      message: `The ${label} is not effective until ${eff.toISOString().slice(0, 10)}.`,
    });
    return;
  }
  b.push({
    validatorId: "policy_in_force",
    rule: `policy_in_force:${label}`,
    passed: true,
    message: `The ${label} is currently in force (expires ${exp.toISOString().slice(0, 10)}).`,
  });
}

/**
 * Limit check — INFORMATIONAL by design: a genuine in-force policy below the
 * threshold is still a valid document; whether stacked coverage clears the
 * requirement is the coverage-determination lane's call (§6.6), never a
 * per-document rejection.
 */
function pushLimitRule(
  b: RuleBuilder,
  line: string,
  occurrence: number | null,
  requiredUsd: number,
): void {
  if (occurrence === null) {
    b.push({
      validatorId: "limit_meets_threshold",
      rule: `limit_meets_threshold:${line}:unreadable`,
      passed: true,
      informational: true,
      message: `No readable per-occurrence limit for ${line.replaceAll("_", " ").toLowerCase()} — the coverage review will decide.`,
    });
    return;
  }
  if (occurrence >= requiredUsd) {
    b.push({
      validatorId: "limit_meets_threshold",
      rule: `limit_meets_threshold:${line}`,
      passed: true,
      message: `${line.replaceAll("_", " ").toLowerCase()} limit ${usdFmt(occurrence)} meets the required ${usdFmt(requiredUsd)}.`,
    });
    return;
  }
  b.push({
    validatorId: "limit_meets_threshold",
    rule: `limit_meets_threshold:${line}:below`,
    passed: true,
    informational: true,
    message: `${line.replaceAll("_", " ").toLowerCase()} limit ${usdFmt(occurrence)} is below the required ${usdFmt(requiredUsd)} — stacked umbrella/excess coverage may still satisfy it.`,
  });
}

function pushSignedRule(
  b: RuleBuilder,
  signaturePresent: boolean | null,
  signatureDate: unknown,
  label: string,
  options?: { informationalWhenMissing?: boolean },
): void {
  // Non-strict by design: a dated certification counts as signed.
  const signed = signaturePresent === true || parseIsoDate(signatureDate) !== null;
  if (signed) {
    b.push({
      validatorId: "is_signed",
      rule: `is_signed:${label}`,
      passed: true,
      message: `The ${label} is signed.`,
    });
    return;
  }
  if (options?.informationalWhenMissing) {
    b.push({
      validatorId: "is_signed",
      rule: `is_signed:${label}:missing`,
      passed: true,
      informational: true,
      message: `No signature is visible on the ${label}.`,
    });
    return;
  }
  b.push({
    validatorId: "is_signed",
    rule: `is_signed:${label}:missing`,
    passed: false,
    message: `The ${label} is not signed. Please upload a signed copy.`,
  });
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (30.44 * 24 * 60 * 60 * 1000);
}

// =============================================================================
// Per-type validators
// =============================================================================

type CoverageLineRecord = {
  line: CoverageLine;
  policy_number: string | null;
  occurrence_limit_usd: number | null;
  aggregate_limit_usd: number | null;
  effective_date: string | null;
  expiration_date: string | null;
};

export function readCoverageLines(
  extractedData: Record<string, unknown>,
): CoverageLineRecord[] {
  const raw = Array.isArray(extractedData.coverage_lines)
    ? (extractedData.coverage_lines as Record<string, unknown>[])
    : [];
  const lines: CoverageLineRecord[] = [];
  for (const entry of raw) {
    const line =
      typeof entry.line === "string" &&
      (COVERAGE_LINE_VALUES as readonly string[]).includes(entry.line)
        ? (entry.line as CoverageLine)
        : "OTHER";
    lines.push({
      line,
      policy_number: typeof entry.policy_number === "string" ? entry.policy_number : null,
      occurrence_limit_usd:
        typeof entry.occurrence_limit_usd === "number" ? entry.occurrence_limit_usd : null,
      aggregate_limit_usd:
        typeof entry.aggregate_limit_usd === "number" ? entry.aggregate_limit_usd : null,
      effective_date: typeof entry.effective_date === "string" ? entry.effective_date : null,
      expiration_date:
        typeof entry.expiration_date === "string" ? entry.expiration_date : null,
    });
  }
  return lines;
}

function limitForLine(line: CoverageLine, t: RequirementThresholds): number {
  switch (line) {
    case "GENERAL_LIABILITY":
      return t.glOccurrenceUsd;
    case "AUTO":
      return t.autoLimitUsd;
    case "WORKERS_COMP":
      return t.wcLimitUsd;
    case "CYBER":
      return t.cyberLimitUsd;
    default:
      return 0;
  }
}

function validateAcord25(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
  thresholds: RequirementThresholds,
  now: Date,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "insured_name"), vendor, "certificate");

  const lines = readCoverageLines(data);
  if (lines.length === 0) {
    b.push({
      validatorId: "field_present",
      rule: "field_present:coverage_lines",
      passed: false,
      message: "No coverage lines could be read from the certificate.",
    });
  }
  for (const line of lines) {
    if (line.line === "OTHER") continue;
    const label = `${line.line.replaceAll("_", " ").toLowerCase()} coverage`;
    pushInForceRule(b, line.effective_date, line.expiration_date, label, now);
    const required = limitForLine(line.line, thresholds);
    if (required > 0) {
      pushLimitRule(b, line.line, line.occurrence_limit_usd, required);
    }
  }

  const hasGl = lines.some((l) => l.line === "GENERAL_LIABILITY");
  if (hasGl && thresholds.requireAdditionalInsured) {
    const ai = bool(data, "additional_insured");
    if (ai === true) {
      b.push({
        validatorId: "endorsement_present",
        rule: "endorsement_present:additional_insured",
        passed: true,
        message: "Additional-insured status is indicated on the certificate.",
      });
    } else if (ai === false) {
      b.push({
        validatorId: "endorsement_present",
        rule: "endorsement_present:additional_insured:absent",
        passed: false,
        message:
          "The certificate indicates the certificate holder is NOT an additional insured — an additional-insured endorsement is required.",
      });
    } else if (vendor?.blanketEndorsementConfirmed) {
      b.push({
        validatorId: "endorsement_present",
        rule: "endorsement_present:additional_insured:confirmed",
        passed: true,
        message: "A blanket additional-insured endorsement was confirmed to apply.",
      });
    } else if (vendor?.blanketEndorsementDenied) {
      b.push({
        validatorId: "endorsement_present",
        rule: "endorsement_present:additional_insured:denied",
        passed: false,
        message:
          "You confirmed no blanket additional-insured endorsement applies — an additional-insured endorsement is required.",
      });
    } else {
      b.push({
        validatorId: "endorsement_present",
        rule: "endorsement_present:additional_insured:unstated",
        passed: true,
        informational: true,
        message:
          "The certificate does not state additional-insured status — confirm whether a blanket endorsement applies.",
      });
    }
  }
  if (hasGl && thresholds.requireWaiverOfSubrogation) {
    const wos = bool(data, "waiver_of_subrogation");
    b.push(
      wos === true
        ? {
            validatorId: "endorsement_present",
            rule: "endorsement_present:waiver_of_subrogation",
            passed: true,
            message: "A waiver of subrogation is indicated.",
          }
        : {
            validatorId: "endorsement_present",
            rule: "endorsement_present:waiver_of_subrogation:absent",
            passed: false,
            message: "A waiver of subrogation is required but not indicated.",
          },
    );
  }

  const holder = str(data, "certificate_holder");
  if (vendor?.buyingOrgName) {
    const match = holder
      ? compareEntityNames(holder, { legalName: vendor.buyingOrgName })
      : null;
    b.push({
      validatorId: "certificate_holder_correct",
      rule: "certificate_holder_correct",
      passed: true,
      informational: match?.confidence === "clearMatch" ? undefined : true,
      message:
        match?.confidence === "clearMatch"
          ? "The certificate holder names the buying organization."
          : "The certificate holder does not clearly name the buying organization — request a reissued certificate if needed.",
    });
  }

  pushSignedRule(b, bool(data, "signature_present"), null, "certificate", {
    informationalWhenMissing: true,
  });
  return b.rules;
}

function validatePolicyDoc(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
  thresholds: RequirementThresholds,
  now: Date,
  kind: "dec_page" | "umbrella" | "cyber",
): ValidationRule[] {
  const b = makeBuilder();
  const label =
    kind === "dec_page"
      ? "declarations page"
      : kind === "umbrella"
        ? "umbrella policy"
        : "cyber policy";
  pushEntityNameRule(b, str(data, "insured_name"), vendor, label);
  pushInForceRule(b, data.effective_date, data.expiration_date, label, now);

  if (kind === "dec_page") {
    const line = str(data, "line");
    if (
      line &&
      (COVERAGE_LINE_VALUES as readonly string[]).includes(line) &&
      line !== "OTHER" &&
      line !== "UMBRELLA"
    ) {
      pushLimitRule(
        b,
        line,
        num(data, "occurrence_limit_usd"),
        limitForLine(line as CoverageLine, thresholds),
      );
    }
  }
  if (kind === "umbrella") {
    const schedule = Array.isArray(data.scheduled_underlying_policies)
      ? (data.scheduled_underlying_policies as unknown[])
      : [];
    b.push({
      validatorId: "field_present",
      rule: "field_present:scheduled_underlying_policies",
      passed: true,
      informational: schedule.length === 0 ? true : undefined,
      message:
        schedule.length > 0
          ? `The umbrella schedules ${schedule.length} underlying ${schedule.length === 1 ? "policy" : "policies"}.`
          : "No schedule of underlying policies is visible — the coverage review will need to confirm the umbrella sits over the general-liability policy.",
    });
  }
  if (kind === "cyber") {
    pushLimitRule(b, "CYBER", num(data, "occurrence_limit_usd"), thresholds.cyberLimitUsd);
  }
  return b.rules;
}

function validateW9(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "legal_name"), vendor, "W-9");
  const tin = str(data, "tin_last4");
  const tinDigits = tin ? tin.replace(/\D/g, "") : "";
  b.push(
    tinDigits.length === 4
      ? {
          validatorId: "tin_present_and_masked",
          rule: "tin_present_and_masked",
          passed: true,
          message: "A taxpayer identification number is present.",
        }
      : {
          validatorId: "tin_present_and_masked",
          rule: "tin_present_and_masked:missing",
          passed: false,
          message: "No readable taxpayer identification number — Part I must be completed.",
        },
  );
  if (bool(data, "tin_fully_visible") === true) {
    b.push({
      validatorId: "tin_present_and_masked",
      rule: "tin_present_and_masked:fully_visible",
      passed: true,
      informational: true,
      message:
        "The document shows the full unmasked TIN — only the last four digits were recorded.",
    });
  }
  pushSignedRule(b, bool(data, "signature_present"), data.signature_date, "W-9 certification");
  return b.rules;
}

function validateW8(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "legal_name"), vendor, "W-8BEN-E");
  b.push(
    str(data, "country_of_incorporation")
      ? {
          validatorId: "field_present",
          rule: "field_present:country_of_incorporation",
          passed: true,
          message: "The country of incorporation is stated.",
        }
      : {
          validatorId: "field_present",
          rule: "field_present:country_of_incorporation:missing",
          passed: false,
          message: "The country of incorporation could not be read.",
        },
  );
  pushSignedRule(
    b,
    bool(data, "signature_present"),
    data.signature_date,
    "W-8BEN-E certification",
  );
  return b.rules;
}

function validateBusinessLicense(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
  now: Date,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "business_name"), vendor, "license");
  pushInForceRule(b, data.issue_date, data.expiration_date, "license", now);
  const state = str(data, "jurisdiction_state");
  const workStates = vendor?.workStates?.filter((s) => s.trim().length > 0) ?? [];
  if (workStates.length > 0 && state) {
    const matches = workStates.some(
      (s) => s.trim().toUpperCase() === state.trim().toUpperCase(),
    );
    b.push(
      matches
        ? {
            validatorId: "jurisdiction_match",
            rule: "jurisdiction_match",
            passed: true,
            message: `The license jurisdiction (${state.toUpperCase()}) matches a registered work state.`,
          }
        : {
            validatorId: "jurisdiction_match",
            rule: "jurisdiction_match:mismatch",
            passed: false,
            message: `The license is issued in ${state.toUpperCase()}, which is not one of the registered work states (${workStates.join(", ")}).`,
          },
    );
  } else {
    b.push({
      validatorId: "jurisdiction_match",
      rule: "jurisdiction_match:unverified",
      passed: true,
      informational: true,
      message: "Jurisdiction could not be verified against the registered work states.",
    });
  }
  return b.rules;
}

function validateDiversityCert(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
  now: Date,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "business_name"), vendor, "certification");
  pushInForceRule(b, data.issue_date, data.expiration_date, "certification", now);
  b.push({
    validatorId: "field_present",
    rule: "field_present:certifying_body",
    passed: true,
    informational: str(data, "certifying_body") ? undefined : true,
    message: str(data, "certifying_body")
      ? `Issued by ${str(data, "certifying_body")}.`
      : "The certifying body could not be read.",
  });
  return b.rules;
}

function validateEmrLetter(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
  thresholds: RequirementThresholds,
  now: Date,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "business_name"), vendor, "EMR letter");
  const emr = num(data, "emr_value");
  if (emr === null) {
    b.push({
      validatorId: "emr_within_bound",
      rule: "emr_within_bound:unreadable",
      passed: false,
      message: "The EMR value could not be read from the letter.",
    });
  } else if (emr <= thresholds.emrMax) {
    b.push({
      validatorId: "emr_within_bound",
      rule: "emr_within_bound",
      passed: true,
      message: `EMR ${emr.toFixed(2)} is within the required maximum of ${thresholds.emrMax.toFixed(2)}.`,
    });
  } else {
    b.push({
      validatorId: "emr_within_bound",
      rule: "emr_within_bound:above",
      passed: false,
      message: `EMR ${emr.toFixed(2)} exceeds the required maximum of ${thresholds.emrMax.toFixed(2)}.`,
    });
  }
  const letterDate = parseIsoDate(data.letter_date);
  if (letterDate) {
    const recent = monthsBetween(letterDate, now) <= 12;
    b.push({
      validatorId: "report_recent",
      rule: recent ? "report_recent:emr_letter" : "report_recent:emr_letter:stale",
      passed: recent,
      message: recent
        ? "The letter is less than 12 months old."
        : "The letter is more than 12 months old — request a current-year EMR letter.",
    });
  } else {
    b.push({
      validatorId: "report_recent",
      rule: "report_recent:emr_letter:undated",
      passed: true,
      informational: true,
      message: "The letter date could not be read.",
    });
  }
  return b.rules;
}

function validateOsha300a(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
  now: Date,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "establishment_name"), vendor, "OSHA 300A");
  const year = str(data, "year");
  const parsedYear = year ? Number.parseInt(year, 10) : Number.NaN;
  const currentYear = now.getUTCFullYear();
  if (Number.isFinite(parsedYear) && parsedYear >= currentYear - 1) {
    b.push({
      validatorId: "report_recent",
      rule: "report_recent:osha_300a",
      passed: true,
      message: `Covers calendar year ${parsedYear}.`,
    });
  } else {
    b.push({
      validatorId: "report_recent",
      rule: "report_recent:osha_300a:stale",
      passed: false,
      message: `The summary covers ${year ?? "an unreadable year"} — the most recent year's summary is required.`,
    });
  }
  pushSignedRule(b, bool(data, "certified_by_signature"), null, "300A certification", {
    informationalWhenMissing: true,
  });
  return b.rules;
}

function validateSoc2(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
  thresholds: RequirementThresholds,
  now: Date,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "organization_name"), vendor, "SOC 2 report");
  const anchor = parseIsoDate(data.period_end) ?? parseIsoDate(data.report_date);
  if (!anchor) {
    b.push({
      validatorId: "report_recent",
      rule: "report_recent:soc2:undated",
      passed: false,
      message: "The report period could not be read.",
    });
  } else if (monthsBetween(anchor, now) <= thresholds.soc2MaxAgeMonths) {
    b.push({
      validatorId: "report_recent",
      rule: "report_recent:soc2",
      passed: true,
      message: `The report period ends within the last ${thresholds.soc2MaxAgeMonths} months.`,
    });
  } else {
    b.push({
      validatorId: "report_recent",
      rule: "report_recent:soc2:stale",
      passed: false,
      message: `The report is older than ${thresholds.soc2MaxAgeMonths} months — a current report (or bridge letter) is required.`,
    });
  }
  const opinion = str(data, "opinion")?.toLowerCase() ?? null;
  if (opinion === "adverse" || opinion === "disclaimer") {
    b.push({
      validatorId: "field_present",
      rule: "field_present:opinion:adverse",
      passed: false,
      message: `The auditor issued a ${opinion} opinion.`,
    });
  } else if (opinion === "qualified") {
    b.push({
      validatorId: "field_present",
      rule: "field_present:opinion:qualified",
      passed: true,
      informational: true,
      message: "The auditor issued a qualified opinion — review the exceptions.",
    });
  }
  return b.rules;
}

function validateIso27001(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
  now: Date,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "organization_name"), vendor, "certificate");
  pushInForceRule(b, data.issue_date, data.expiration_date, "certificate", now);
  return b.rules;
}

function validateBankLetter(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
  now: Date,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "business_name"), vendor, "bank letter");
  b.push(
    str(data, "account_last4")
      ? {
          validatorId: "field_present",
          rule: "field_present:account_last4",
          passed: true,
          message: "An account reference is present (last four digits recorded).",
        }
      : {
          validatorId: "field_present",
          rule: "field_present:account_last4:missing",
          passed: false,
          message: "No readable account reference on the letter.",
        },
  );
  pushSignedRule(b, bool(data, "signature_present"), null, "bank letter");
  const letterDate = parseIsoDate(data.letter_date);
  b.push({
    validatorId: "report_recent",
    rule: "report_recent:bank_letter",
    passed: true,
    informational: letterDate && monthsBetween(letterDate, now) <= 12 ? undefined : true,
    message:
      letterDate && monthsBetween(letterDate, now) <= 12
        ? "The letter is less than 12 months old."
        : "The letter is undated or more than 12 months old.",
  });
  return b.rules;
}

function validateVoidCheck(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
): ValidationRule[] {
  const b = makeBuilder();
  pushEntityNameRule(b, str(data, "business_name"), vendor, "check");
  b.push(
    str(data, "account_last4")
      ? {
          validatorId: "field_present",
          rule: "field_present:account_last4",
          passed: true,
          message: "An account reference is present (last four digits recorded).",
        }
      : {
          validatorId: "field_present",
          rule: "field_present:account_last4:missing",
          passed: false,
          message: "The account number could not be read.",
        },
  );
  if (bool(data, "marked_void") !== true) {
    b.push({
      validatorId: "field_present",
      rule: "field_present:marked_void",
      passed: true,
      informational: true,
      message: "The check is not clearly marked VOID.",
    });
  }
  return b.rules;
}

function validateAgreement(
  data: Record<string, unknown>,
  vendor: VendorContext | undefined,
  label: string,
): ValidationRule[] {
  const b = makeBuilder();
  const parties = Array.isArray(data.party_names)
    ? (data.party_names as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  if (vendor?.legalName && parties.length > 0) {
    const anyMatch = parties.some(
      (p) =>
        compareEntityNames(p, {
          legalName: vendor.legalName,
          dbaName: vendor.dbaName ?? null,
        }).confidence !== "noMatch",
    );
    b.push(
      anyMatch
        ? {
            validatorId: "entity_name_match",
            rule: "entity_name_match:party",
            passed: true,
            message: `The vendor is named as a party to the ${label}.`,
          }
        : {
            validatorId: "entity_name_match",
            rule: "entity_name_match:party:mismatch",
            passed: false,
            message: `The registered vendor is not named as a party to the ${label}.`,
            nameMatchConfidence: "noMatch",
          },
    );
  } else {
    pushEntityNameRule(b, parties[0] ?? null, vendor, label);
  }
  pushSignedRule(
    b,
    bool(data, "vendor_signature_present"),
    data.signature_date,
    `${label} (vendor signature)`,
  );
  const counterSigned = bool(data, "counterparty_signature_present");
  b.push({
    validatorId: "is_signed",
    rule: "is_signed:counterparty",
    passed: true,
    informational: counterSigned === true ? undefined : true,
    message:
      counterSigned === true
        ? `The ${label} is countersigned.`
        : `The buying organization's countersignature is not visible on the ${label}.`,
  });
  return b.rules;
}

// =============================================================================
// Orchestrator: per-type dispatch switch
// =============================================================================

export function validateVendorDocument(
  documentType: VendorDocumentType,
  extractedData: Record<string, unknown>,
  vendorContext?: VendorContext,
  validationContext?: DocumentValidationContext,
  referenceDate?: Date,
): ValidationResult | null {
  const now = referenceDate ?? new Date();
  const thresholds = validationContext?.thresholds ?? DEFAULT_THRESHOLDS;

  let rules: ValidationRule[];
  switch (documentType) {
    case VendorDocumentTypeEnum.ACORD_25_COI:
      rules = validateAcord25(extractedData, vendorContext, thresholds, now);
      break;
    case VendorDocumentTypeEnum.INSURANCE_POLICY_DEC_PAGE:
      rules = validatePolicyDoc(extractedData, vendorContext, thresholds, now, "dec_page");
      break;
    case VendorDocumentTypeEnum.UMBRELLA_POLICY:
      rules = validatePolicyDoc(extractedData, vendorContext, thresholds, now, "umbrella");
      break;
    case VendorDocumentTypeEnum.CYBER_POLICY:
      rules = validatePolicyDoc(extractedData, vendorContext, thresholds, now, "cyber");
      break;
    case VendorDocumentTypeEnum.W9:
      rules = validateW9(extractedData, vendorContext);
      break;
    case VendorDocumentTypeEnum.W8_BEN_E:
      rules = validateW8(extractedData, vendorContext);
      break;
    case VendorDocumentTypeEnum.BUSINESS_LICENSE:
      rules = validateBusinessLicense(extractedData, vendorContext, now);
      break;
    case VendorDocumentTypeEnum.DIVERSITY_CERT:
      rules = validateDiversityCert(extractedData, vendorContext, now);
      break;
    case VendorDocumentTypeEnum.EMR_LETTER:
      rules = validateEmrLetter(extractedData, vendorContext, thresholds, now);
      break;
    case VendorDocumentTypeEnum.OSHA_300A:
      rules = validateOsha300a(extractedData, vendorContext, now);
      break;
    case VendorDocumentTypeEnum.SOC2_REPORT:
      rules = validateSoc2(extractedData, vendorContext, thresholds, now);
      break;
    case VendorDocumentTypeEnum.ISO_27001_CERT:
      rules = validateIso27001(extractedData, vendorContext, now);
      break;
    case VendorDocumentTypeEnum.BANK_LETTER:
      rules = validateBankLetter(extractedData, vendorContext, now);
      break;
    case VendorDocumentTypeEnum.VOID_CHECK:
      rules = validateVoidCheck(extractedData, vendorContext);
      break;
    case VendorDocumentTypeEnum.MSA_SIGNED:
      rules = validateAgreement(extractedData, vendorContext, "master services agreement");
      break;
    case VendorDocumentTypeEnum.NDA_SIGNED:
      rules = validateAgreement(extractedData, vendorContext, "non-disclosure agreement");
      break;
    case VendorDocumentTypeEnum.UNKNOWN:
      return null;
    default:
      return null;
  }

  // valid = every non-informational rule passed.
  const valid = rules.filter((r) => !r.informational).every((r) => r.passed);
  return {
    valid,
    documentType,
    validators_array: [...new Set(rules.map((r) => r.validatorId))],
    rules,
  };
}

/**
 * The non-informational failed rule messages — the single derivation shared
 * by the server (terminal part / fail reason) and client projections, so
 * live and reloaded cards can never disagree on the red copy.
 */
export function failedValidationMessages(
  rules: readonly ValidationRule[],
): string[] {
  return rules
    .filter((rule) => !rule.passed && !rule.informational)
    .map((rule) => rule.message);
}
