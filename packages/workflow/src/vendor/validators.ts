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

/** The closed validator vocabulary as a value — zod enums and the admission
 * facts derive from it, so it can never drift from the type (SPEC §23.7). */
export const VENDOR_VALIDATOR_ID_VALUES = [
  "entity_name_match",
  "is_signed",
  "tin_present_and_masked",
  "limit_meets_threshold",
  "endorsement_present",
  "policy_in_force",
  "emr_within_bound",
  "report_recent",
  "jurisdiction_match",
  "certificate_holder_correct",
  "field_present",
] as const;

export type VendorValidatorId = (typeof VENDOR_VALIDATOR_ID_VALUES)[number];

/**
 * The validator ids each document type can emit (SPEC §19.2) — the set a company
 * chooses from in the governance console.
 *
 * `ValidationResult.validators_array` is per-INPUT (the ids that actually fired
 * for one document), so it can never serve as this catalog. This map is declared
 * and kept honest by enumeration: `assertValidatorCatalogCovers` proves the
 * emitted ids are a subset of the declared ones for every type.
 */
export const VALIDATORS_BY_DOCUMENT_TYPE: Record<
  VendorDocumentType,
  readonly VendorValidatorId[]
> = {
  ACORD_25_COI: [
    "entity_name_match",
    "policy_in_force",
    "limit_meets_threshold",
    "endorsement_present",
    "certificate_holder_correct",
    "is_signed",
    "field_present",
  ],
  INSURANCE_POLICY_DEC_PAGE: [
    "entity_name_match",
    "policy_in_force",
    "limit_meets_threshold",
    "field_present",
  ],
  UMBRELLA_POLICY: [
    "entity_name_match",
    "policy_in_force",
    "limit_meets_threshold",
    "field_present",
  ],
  CYBER_POLICY: [
    "entity_name_match",
    "policy_in_force",
    "limit_meets_threshold",
    "field_present",
  ],
  W9: ["entity_name_match", "is_signed", "tin_present_and_masked"],
  W8_BEN_E: ["entity_name_match", "is_signed", "field_present"],
  BUSINESS_LICENSE: ["entity_name_match", "policy_in_force", "jurisdiction_match"],
  DIVERSITY_CERT: ["entity_name_match", "policy_in_force", "field_present"],
  EMR_LETTER: ["entity_name_match", "emr_within_bound", "report_recent"],
  OSHA_300A: ["entity_name_match", "is_signed", "report_recent"],
  SOC2_REPORT: ["entity_name_match", "report_recent", "field_present"],
  ISO_27001_CERT: ["entity_name_match", "policy_in_force"],
  BANK_LETTER: [
    "entity_name_match",
    "is_signed",
    "report_recent",
    "field_present",
  ],
  VOID_CHECK: ["entity_name_match", "field_present"],
  MSA_SIGNED: ["entity_name_match", "is_signed"],
  NDA_SIGNED: ["entity_name_match", "is_signed"],
  UNKNOWN: [],
};

/** Vendor-facing labels for the governance console (Spanish, trato de usted). */
export const VALIDATOR_LABELS: Record<VendorValidatorId, string> = {
  entity_name_match: "El nombre de la empresa coincide",
  is_signed: "El documento está firmado",
  tin_present_and_masked: "Identificación fiscal presente y enmascarada",
  limit_meets_threshold: "El límite alcanza el mínimo exigido",
  endorsement_present: "Endosos requeridos presentes",
  policy_in_force: "La vigencia cubre la fecha actual",
  emr_within_bound: "El EMR está dentro del máximo",
  report_recent: "El informe es suficientemente reciente",
  jurisdiction_match: "La jurisdicción corresponde",
  certificate_holder_correct: "El titular del certificado es correcto",
  field_present: "Campos obligatorios presentes",
};

export interface ValidatorCatalogEntry {
  id: VendorValidatorId;
  label: string;
  /** Document types this validator can run against. */
  documentTypes: VendorDocumentType[];
}

/** The validator superset, for the governance console. */
export function listValidatorCatalog(): ValidatorCatalogEntry[] {
  const ids = Object.keys(VALIDATOR_LABELS) as VendorValidatorId[];
  return ids.map((id) => ({
    id,
    label: VALIDATOR_LABELS[id],
    documentTypes: (
      Object.keys(VALIDATORS_BY_DOCUMENT_TYPE) as VendorDocumentType[]
    ).filter((type) => VALIDATORS_BY_DOCUMENT_TYPE[type].includes(id)),
  }));
}

/** Is this validator applicable to this document type? (admissibility input) */
export function isValidatorApplicable(
  documentType: VendorDocumentType,
  validatorId: string,
): boolean {
  return (
    VALIDATORS_BY_DOCUMENT_TYPE[documentType] as readonly string[]
  ).includes(validatorId);
}

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
  return `$${n.toLocaleString("es-419")}`;
}

/**
 * Spanish display forms (gender-correct article embedded) for the English
 * document labels that rule-ID strings are keyed on. Rule IDs keep the raw
 * English label bytes (persistence/e2e contract); only rendered messages go
 * through this map.
 */
const DISPLAY_LABELS: Record<string, string> = {
  certificate: "el certificado",
  "declarations page": "la página de declaraciones",
  "umbrella policy": "la póliza umbrella",
  "cyber policy": "la póliza cibernética",
  "W-9": "el formulario W-9",
  "W-9 certification": "la certificación del W-9",
  "W-8BEN-E": "el formulario W-8BEN-E",
  "W-8BEN-E certification": "la certificación del W-8BEN-E",
  license: "la licencia",
  certification: "la certificación",
  "EMR letter": "la carta de EMR",
  "OSHA 300A": "el resumen OSHA 300A",
  "300A certification": "la certificación del 300A",
  "SOC 2 report": "el informe SOC 2",
  "bank letter": "la carta bancaria",
  check: "el cheque",
  "master services agreement": "el contrato marco de servicios",
  "non-disclosure agreement": "el acuerdo de confidencialidad",
};

/**
 * Spanish names for CoverageLine enum members — used in messages only; rule
 * IDs keep the raw enum value.
 */
const COVERAGE_LINE_LABELS: Record<string, string> = {
  GENERAL_LIABILITY: "responsabilidad civil general",
  WORKERS_COMP: "compensación laboral",
  AUTO: "auto comercial",
  UMBRELLA: "umbrella",
  CYBER: "responsabilidad cibernética",
  OTHER: "otra línea",
};

const VENDOR_SIGNATURE_SUFFIX = " (vendor signature)";
const COVERAGE_LABEL_SUFFIX = " coverage";

function coverageLineLabel(line: string): string {
  return COVERAGE_LINE_LABELS[line] ?? line.replaceAll("_", " ").toLowerCase();
}

/** Resolve a rule-ID label to its Spanish display form; raw label fallback. */
function displayLabel(label: string): string {
  const direct = DISPLAY_LABELS[label];
  if (direct) return direct;
  if (label.endsWith(VENDOR_SIGNATURE_SUFFIX)) {
    const base = label.slice(0, -VENDOR_SIGNATURE_SUFFIX.length);
    return `${DISPLAY_LABELS[base] ?? base} (firma del proveedor)`;
  }
  if (label.endsWith(COVERAGE_LABEL_SUFFIX)) {
    const base = label.slice(0, -COVERAGE_LABEL_SUFFIX.length);
    return `la cobertura de ${coverageLineLabel(base.replaceAll(" ", "_").toUpperCase())}`;
  }
  return label;
}

/** Uppercases the first letter for sentence-initial use. */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "de" contraction for a display label: "el X" → "del X"; else "de X". */
function de(display: string): string {
  return display.startsWith("el ") ? `del ${display.slice(3)}` : `de ${display}`;
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
      message: "No hay un nombre de proveedor registrado en el expediente — no se realizó la verificación del nombre.",
    });
    return;
  }
  if (vendor.entityConfirmed) {
    b.push({
      validatorId: "entity_name_match",
      rule: "entity_name_match:confirmed",
      passed: true,
      message: `Se confirmó que la entidad nombrada en ${displayLabel(documentLabel)} es la misma empresa.`,
      nameMatchConfidence: "clearMatch",
    });
    return;
  }
  if (!extractedName) {
    b.push({
      validatorId: "entity_name_match",
      rule: "entity_name_match:missing",
      passed: false,
      message: `${cap(displayLabel(documentLabel))} no muestra un nombre de empresa legible.`,
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
      message: `El nombre en ${displayLabel(documentLabel)} coincide con el proveedor registrado${comparison.matchedAgainst === "dba" ? " (nombre DBA)" : ""}.`,
      nameMatchConfidence: comparison.confidence,
    });
    return;
  }
  b.push({
    validatorId: "entity_name_match",
    rule: "entity_name_match:mismatch",
    passed: false,
    message: `El nombre en ${displayLabel(documentLabel)} ("${extractedName}") no coincide con el proveedor registrado ("${vendor.legalName}").`,
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
      message: `${cap(displayLabel(label))} no muestra una fecha de vencimiento legible.`,
    });
    return;
  }
  if (exp.getTime() <= now.getTime()) {
    b.push({
      validatorId: "policy_in_force",
      rule: `policy_in_force:${label}:expired`,
      passed: false,
      message: `${cap(displayLabel(label))} venció el ${exp.toISOString().slice(0, 10)}.`,
    });
    return;
  }
  if (eff && eff.getTime() > now.getTime()) {
    b.push({
      validatorId: "policy_in_force",
      rule: `policy_in_force:${label}:not_yet_effective`,
      passed: false,
      message: `${cap(displayLabel(label))} no entra en vigor hasta el ${eff.toISOString().slice(0, 10)}.`,
    });
    return;
  }
  b.push({
    validatorId: "policy_in_force",
    rule: `policy_in_force:${label}`,
    passed: true,
    message: `${cap(displayLabel(label))} está actualmente en vigor (vence el ${exp.toISOString().slice(0, 10)}).`,
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
      message: `No hay un límite por ocurrencia legible para ${coverageLineLabel(line)} — la revisión de cobertura lo decidirá.`,
    });
    return;
  }
  if (occurrence >= requiredUsd) {
    b.push({
      validatorId: "limit_meets_threshold",
      rule: `limit_meets_threshold:${line}`,
      passed: true,
      message: `El límite de ${coverageLineLabel(line)} de ${usdFmt(occurrence)} cumple con el requerido de ${usdFmt(requiredUsd)}.`,
    });
    return;
  }
  b.push({
    validatorId: "limit_meets_threshold",
    rule: `limit_meets_threshold:${line}:below`,
    passed: true,
    informational: true,
    message: `El límite de ${coverageLineLabel(line)} de ${usdFmt(occurrence)} está por debajo del requerido de ${usdFmt(requiredUsd)} — la cobertura acumulada de pólizas umbrella o de exceso aún podría satisfacerlo.`,
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
      message: `${cap(displayLabel(label))} cuenta con firma.`,
    });
    return;
  }
  if (options?.informationalWhenMissing) {
    b.push({
      validatorId: "is_signed",
      rule: `is_signed:${label}:missing`,
      passed: true,
      informational: true,
      message: `No se observa una firma en ${displayLabel(label)}.`,
    });
    return;
  }
  b.push({
    validatorId: "is_signed",
    rule: `is_signed:${label}:missing`,
    passed: false,
    message: `${cap(displayLabel(label))} no tiene firma. Por favor, suba una copia firmada.`,
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
      message: "No se pudieron leer líneas de cobertura del certificado.",
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
        message: "La condición de asegurado adicional está indicada en el certificado.",
      });
    } else if (ai === false) {
      b.push({
        validatorId: "endorsement_present",
        rule: "endorsement_present:additional_insured:absent",
        passed: false,
        message:
          "El certificado indica que el titular del certificado NO es un asegurado adicional — se requiere un endoso de asegurado adicional.",
      });
    } else if (vendor?.blanketEndorsementConfirmed) {
      b.push({
        validatorId: "endorsement_present",
        rule: "endorsement_present:additional_insured:confirmed",
        passed: true,
        message: "Se confirmó que aplica un endoso general (blanket) de asegurado adicional.",
      });
    } else if (vendor?.blanketEndorsementDenied) {
      b.push({
        validatorId: "endorsement_present",
        rule: "endorsement_present:additional_insured:denied",
        passed: false,
        message:
          "Usted confirmó que no aplica ningún endoso general (blanket) de asegurado adicional — se requiere un endoso de asegurado adicional.",
      });
    } else {
      b.push({
        validatorId: "endorsement_present",
        rule: "endorsement_present:additional_insured:unstated",
        passed: true,
        informational: true,
        message:
          "El certificado no indica la condición de asegurado adicional — confirme si aplica un endoso general (blanket).",
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
            message: "Se indica una renuncia a la subrogación.",
          }
        : {
            validatorId: "endorsement_present",
            rule: "endorsement_present:waiver_of_subrogation:absent",
            passed: false,
            message: "Se requiere una renuncia a la subrogación, pero no está indicada.",
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
          ? "El titular del certificado nombra a la organización compradora."
          : "El titular del certificado no nombra claramente a la organización compradora — solicite un certificado reemitido si es necesario.",
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
          ? `La póliza umbrella lista ${schedule.length} ${schedule.length === 1 ? "póliza subyacente" : "pólizas subyacentes"}.`
          : "No se observa un listado de pólizas subyacentes — la revisión de cobertura deberá confirmar que la umbrella se apoya sobre la póliza de responsabilidad civil general.",
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
          message: "El documento incluye un número de identificación del contribuyente.",
        }
      : {
          validatorId: "tin_present_and_masked",
          rule: "tin_present_and_masked:missing",
          passed: false,
          message: "No hay un número de identificación del contribuyente legible — la Parte I debe estar completa.",
        },
  );
  if (bool(data, "tin_fully_visible") === true) {
    b.push({
      validatorId: "tin_present_and_masked",
      rule: "tin_present_and_masked:fully_visible",
      passed: true,
      informational: true,
      message:
        "El documento muestra el TIN completo sin enmascarar — solo se registraron los últimos cuatro dígitos.",
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
          message: "El país de constitución está indicado.",
        }
      : {
          validatorId: "field_present",
          rule: "field_present:country_of_incorporation:missing",
          passed: false,
          message: "No se pudo leer el país de constitución.",
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
            message: `La jurisdicción de la licencia (${state.toUpperCase()}) coincide con un estado de trabajo registrado.`,
          }
        : {
            validatorId: "jurisdiction_match",
            rule: "jurisdiction_match:mismatch",
            passed: false,
            message: `La licencia fue emitida en ${state.toUpperCase()}, que no es uno de los estados de trabajo registrados (${workStates.join(", ")}).`,
          },
    );
  } else {
    b.push({
      validatorId: "jurisdiction_match",
      rule: "jurisdiction_match:unverified",
      passed: true,
      informational: true,
      message: "No se pudo verificar la jurisdicción contra los estados de trabajo registrados.",
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
      ? `Emitida por ${str(data, "certifying_body")}.`
      : "No se pudo leer el organismo certificador.",
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
      message: "No se pudo leer el valor de EMR de la carta.",
    });
  } else if (emr <= thresholds.emrMax) {
    b.push({
      validatorId: "emr_within_bound",
      rule: "emr_within_bound",
      passed: true,
      message: `El EMR ${emr.toFixed(2)} está dentro del máximo requerido de ${thresholds.emrMax.toFixed(2)}.`,
    });
  } else {
    b.push({
      validatorId: "emr_within_bound",
      rule: "emr_within_bound:above",
      passed: false,
      message: `El EMR ${emr.toFixed(2)} excede el máximo requerido de ${thresholds.emrMax.toFixed(2)}.`,
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
        ? "La carta tiene menos de 12 meses de antigüedad."
        : "La carta tiene más de 12 meses de antigüedad — solicite una carta de EMR del año en curso.",
    });
  } else {
    b.push({
      validatorId: "report_recent",
      rule: "report_recent:emr_letter:undated",
      passed: true,
      informational: true,
      message: "No se pudo leer la fecha de la carta.",
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
      message: `Cubre el año calendario ${parsedYear}.`,
    });
  } else {
    b.push({
      validatorId: "report_recent",
      rule: "report_recent:osha_300a:stale",
      passed: false,
      message: `El resumen cubre ${year ?? "un año ilegible"} — se requiere el resumen del año más reciente.`,
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
      message: "No se pudo leer el período del informe.",
    });
  } else if (monthsBetween(anchor, now) <= thresholds.soc2MaxAgeMonths) {
    b.push({
      validatorId: "report_recent",
      rule: "report_recent:soc2",
      passed: true,
      message: `El período del informe termina dentro de los últimos ${thresholds.soc2MaxAgeMonths} meses.`,
    });
  } else {
    b.push({
      validatorId: "report_recent",
      rule: "report_recent:soc2:stale",
      passed: false,
      message: `El informe tiene más de ${thresholds.soc2MaxAgeMonths} meses de antigüedad — se requiere un informe vigente (o una carta puente).`,
    });
  }
  const opinion = str(data, "opinion")?.toLowerCase() ?? null;
  if (opinion === "adverse" || opinion === "disclaimer") {
    b.push({
      validatorId: "field_present",
      rule: "field_present:opinion:adverse",
      passed: false,
      message: `El auditor emitió ${
        opinion === "adverse"
          ? "una opinión adversa"
          : opinion === "disclaimer"
            ? "una abstención de opinión"
            : `una opinión de tipo "${opinion}"`
      }.`,
    });
  } else if (opinion === "qualified") {
    b.push({
      validatorId: "field_present",
      rule: "field_present:opinion:qualified",
      passed: true,
      informational: true,
      message: "El auditor emitió una opinión con salvedades — revise las excepciones.",
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
          message: "Hay una referencia de cuenta (se registraron los últimos cuatro dígitos).",
        }
      : {
          validatorId: "field_present",
          rule: "field_present:account_last4:missing",
          passed: false,
          message: "No hay una referencia de cuenta legible en la carta.",
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
        ? "La carta tiene menos de 12 meses de antigüedad."
        : "La carta no tiene fecha o tiene más de 12 meses de antigüedad.",
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
          message: "Hay una referencia de cuenta (se registraron los últimos cuatro dígitos).",
        }
      : {
          validatorId: "field_present",
          rule: "field_present:account_last4:missing",
          passed: false,
          message: "No se pudo leer el número de cuenta.",
        },
  );
  if (bool(data, "marked_void") !== true) {
    b.push({
      validatorId: "field_present",
      rule: "field_present:marked_void",
      passed: true,
      informational: true,
      message: "El cheque no está claramente marcado como VOID (anulado).",
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
            message: `El proveedor está nombrado como parte ${de(displayLabel(label))}.`,
          }
        : {
            validatorId: "entity_name_match",
            rule: "entity_name_match:party:mismatch",
            passed: false,
            message: `El proveedor registrado no está nombrado como parte ${de(displayLabel(label))}.`,
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
        ? `${cap(displayLabel(label))} cuenta con contrafirma.`
        : `La contrafirma de la organización compradora no se observa en ${displayLabel(label)}.`,
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
