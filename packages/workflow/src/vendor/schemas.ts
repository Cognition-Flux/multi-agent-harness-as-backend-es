/**
 * The Vendra document-type catalog + per-type extraction schemas (SPEC
 * §3.2, §6.5).
 *
 * Every extraction field is `.describe()`d: the descriptions ARE the model's
 * extraction hints (they're rendered into the JSON schema handed to the
 * agent by saveClassification) — this is the calibration lever.
 *
 * PII rule baked into the schemas themselves: full TINs and full bank
 * account numbers are NEVER asked for — only last-4 digits.
 */
import { z } from "zod";

// =============================================================================
// Catalog
// =============================================================================

export const VendorDocumentTypeEnum = {
  ACORD_25_COI: "ACORD_25_COI",
  INSURANCE_POLICY_DEC_PAGE: "INSURANCE_POLICY_DEC_PAGE",
  UMBRELLA_POLICY: "UMBRELLA_POLICY",
  W9: "W9",
  W8_BEN_E: "W8_BEN_E",
  BUSINESS_LICENSE: "BUSINESS_LICENSE",
  DIVERSITY_CERT: "DIVERSITY_CERT",
  EMR_LETTER: "EMR_LETTER",
  OSHA_300A: "OSHA_300A",
  SOC2_REPORT: "SOC2_REPORT",
  ISO_27001_CERT: "ISO_27001_CERT",
  CYBER_POLICY: "CYBER_POLICY",
  BANK_LETTER: "BANK_LETTER",
  VOID_CHECK: "VOID_CHECK",
  MSA_SIGNED: "MSA_SIGNED",
  NDA_SIGNED: "NDA_SIGNED",
  UNKNOWN: "UNKNOWN",
} as const;

export type VendorDocumentType =
  (typeof VendorDocumentTypeEnum)[keyof typeof VendorDocumentTypeEnum];

export const VENDOR_DOCUMENT_TYPE_VALUES = Object.values(
  VendorDocumentTypeEnum,
) as [VendorDocumentType, ...VendorDocumentType[]];

export const VENDOR_DOCUMENT_TYPE_TITLES: Record<VendorDocumentType, string> = {
  ACORD_25_COI: "Certificate of insurance (ACORD 25)",
  INSURANCE_POLICY_DEC_PAGE: "Insurance policy declarations page",
  UMBRELLA_POLICY: "Umbrella / excess liability policy",
  W9: "IRS Form W-9",
  W8_BEN_E: "IRS Form W-8BEN-E",
  BUSINESS_LICENSE: "Business license",
  DIVERSITY_CERT: "Diversity certification",
  EMR_LETTER: "EMR (experience modification rate) letter",
  OSHA_300A: "OSHA Form 300A summary",
  SOC2_REPORT: "SOC 2 report",
  ISO_27001_CERT: "ISO 27001 certificate",
  CYBER_POLICY: "Cyber liability policy",
  BANK_LETTER: "Bank verification letter",
  VOID_CHECK: "Voided check",
  MSA_SIGNED: "Signed master services agreement",
  NDA_SIGNED: "Signed non-disclosure agreement",
  UNKNOWN: "Unknown document",
};

export function vendorDocumentTypeTitle(documentType: string): string {
  return (
    VENDOR_DOCUMENT_TYPE_TITLES[documentType as VendorDocumentType] ??
    documentType.replaceAll("_", " ").toLowerCase()
  );
}

// =============================================================================
// Classification prompt definitions (rendered into the agent's catalog list)
// =============================================================================

export interface DocumentPromptDefinition {
  displayName: string;
  primaryIdentifiers: string[];
  criticalNotes: string[];
}

const PROMPT_DEFINITIONS: Record<
  Exclude<VendorDocumentType, "UNKNOWN">,
  DocumentPromptDefinition
> = {
  ACORD_25_COI: {
    displayName: "Certificate of insurance (ACORD 25)",
    primaryIdentifiers: [
      'the ACORD 25 form layout ("CERTIFICATE OF LIABILITY INSURANCE" title)',
      "an INSURED box, insurer letters A-F, and per-line limits (each occurrence / general aggregate)",
    ],
    criticalNotes: [
      "A certificate SUMMARIZES coverage; a full policy or a declarations page is a different type.",
    ],
  },
  INSURANCE_POLICY_DEC_PAGE: {
    displayName: "Insurance policy declarations page",
    primaryIdentifiers: [
      'a carrier-issued "Declarations" page naming the insured, policy number, policy period, and limits for ONE policy',
    ],
    criticalNotes: [
      "Distinct from an ACORD 25 certificate (which lists several policies in a grid).",
    ],
  },
  UMBRELLA_POLICY: {
    displayName: "Umbrella / excess liability policy",
    primaryIdentifiers: [
      'an "Umbrella", "Excess Liability", or "Commercial Excess" policy or declarations page with its own limit',
      "often a schedule of underlying policies",
    ],
    criticalNotes: [
      "Classify here even when the document is a declarations page, as long as the line of business is umbrella/excess.",
    ],
  },
  W9: {
    displayName: "IRS Form W-9",
    primaryIdentifiers: [
      '"Form W-9" / "Request for Taxpayer Identification Number and Certification" heading',
      "a tax-classification checkbox grid and a Part I TIN box",
    ],
    criticalNotes: [],
  },
  W8_BEN_E: {
    displayName: "IRS Form W-8BEN-E",
    primaryIdentifiers: [
      '"Form W-8BEN-E" heading (Certificate of Status of Beneficial Owner, entities)',
    ],
    criticalNotes: ["Foreign entities file W-8BEN-E instead of W-9."],
  },
  BUSINESS_LICENSE: {
    displayName: "Business license",
    primaryIdentifiers: [
      "a state / county / city-issued license or registration certificate naming the business, a license number, and an expiration date",
    ],
    criticalNotes: [
      "Contractor licenses, general business licenses, and trade registrations all classify here.",
    ],
  },
  DIVERSITY_CERT: {
    displayName: "Diversity certification",
    primaryIdentifiers: [
      "a certifying-body certificate (MBE / WBE / DBE / VOSB / SDVOSB / 8(a) / HUBZone) naming the business",
    ],
    criticalNotes: [
      "Record the certification program as documentSubtype (e.g. MBE, WBE, DBE, VOSB, 8A).",
    ],
  },
  EMR_LETTER: {
    displayName: "EMR letter",
    primaryIdentifiers: [
      "an insurer- or rating-bureau-issued letter stating the business's workers'-comp experience modification rate (EMR / X-Mod)",
    ],
    criticalNotes: [],
  },
  OSHA_300A: {
    displayName: "OSHA Form 300A",
    primaryIdentifiers: [
      '"OSHA\'s Form 300A — Summary of Work-Related Injuries and Illnesses" heading with annual totals',
    ],
    criticalNotes: [],
  },
  SOC2_REPORT: {
    displayName: "SOC 2 report",
    primaryIdentifiers: [
      'an auditor-issued "SOC 2" report (Type I or Type II) or an attestation/bridge letter referencing one',
    ],
    criticalNotes: [],
  },
  ISO_27001_CERT: {
    displayName: "ISO 27001 certificate",
    primaryIdentifiers: [
      "a certification-body certificate stating ISO/IEC 27001 conformity with a certificate number and validity dates",
    ],
    criticalNotes: [],
  },
  CYBER_POLICY: {
    displayName: "Cyber liability policy",
    primaryIdentifiers: [
      "a cyber / technology E&O / privacy-liability policy or declarations page with its own limits",
    ],
    criticalNotes: [],
  },
  BANK_LETTER: {
    displayName: "Bank verification letter",
    primaryIdentifiers: [
      "a bank-letterhead letter confirming the business holds an account (often for ACH setup)",
    ],
    criticalNotes: ["Record only the LAST FOUR digits of any account number."],
  },
  VOID_CHECK: {
    displayName: "Voided check",
    primaryIdentifiers: [
      'a business check marked "VOID" showing the business name and bank',
    ],
    criticalNotes: ["Record only the LAST FOUR digits of account/routing numbers."],
  },
  MSA_SIGNED: {
    displayName: "Signed master services agreement",
    primaryIdentifiers: [
      'a contract titled "Master Services Agreement" (or similar services/subcontract agreement) with signature blocks',
    ],
    criticalNotes: [],
  },
  NDA_SIGNED: {
    displayName: "Signed non-disclosure agreement",
    primaryIdentifiers: [
      'a contract titled "Non-Disclosure Agreement" / "Confidentiality Agreement" with signature blocks',
    ],
    criticalNotes: [],
  },
};

export const UNKNOWN_DOCUMENT_DEFINITION = {
  selectionCriteria: [
    "The document does not convincingly match any accepted type above — never guess a type from partial evidence.",
    "Marketing material, invoices, correspondence, or personal documents are UNKNOWN here.",
  ],
};

export function getDocumentPromptDefinition(
  documentType: VendorDocumentType,
): DocumentPromptDefinition | null {
  if (documentType === VendorDocumentTypeEnum.UNKNOWN) return null;
  return PROMPT_DEFINITIONS[documentType] ?? null;
}

// =============================================================================
// Shared extraction field fragments
// =============================================================================

const isoDate = (what: string) =>
  z
    .string()
    .nullable()
    .describe(
      `${what}, as YYYY-MM-DD. Use null when absent or unreadable — never invent a date.`,
    );

const usd = (what: string) =>
  z
    .number()
    .nullable()
    .describe(
      `${what} in US dollars as a plain number (e.g. 1000000 for $1,000,000). Null when absent/unreadable.`,
    );

const entityName = (what: string) =>
  z
    .string()
    .nullable()
    .describe(
      `${what}, transcribed EXACTLY as printed (including punctuation and suffixes like LLC/Inc). Null when absent.`,
    );

const signaturePresent = (what: string) =>
  z
    .boolean()
    .nullable()
    .describe(
      `True when ${what} shows an actual signature (handwritten, stamped, or a clearly rendered e-signature). False when the signature line is blank. Null when unreadable.`,
    );

// =============================================================================
// Per-type extraction schemas
// =============================================================================

export const COVERAGE_LINE_VALUES = [
  "GENERAL_LIABILITY",
  "WORKERS_COMP",
  "AUTO",
  "UMBRELLA",
  "CYBER",
  "OTHER",
] as const;

export type CoverageLine = (typeof COVERAGE_LINE_VALUES)[number];

const coverageLineSchema = z.object({
  line: z
    .enum(COVERAGE_LINE_VALUES)
    .describe(
      "The line of business: GENERAL_LIABILITY (commercial general liability), WORKERS_COMP (workers' compensation & employers' liability), AUTO (commercial automobile), UMBRELLA (umbrella/excess), CYBER, or OTHER.",
    ),
  policy_number: z
    .string()
    .nullable()
    .describe("The policy number for this line exactly as printed. Null when absent."),
  occurrence_limit_usd: usd(
    "The per-occurrence limit for this line (for WORKERS_COMP use the 'each accident' employers'-liability limit; for AUTO the combined single limit)",
  ),
  aggregate_limit_usd: usd(
    "The general/policy aggregate limit for this line (null when the line shows no aggregate)",
  ),
  effective_date: isoDate("The policy effective date for this line"),
  expiration_date: isoDate("The policy expiration date for this line"),
});

const acord25Schema = z.object({
  insured_name: entityName(
    "The name of the insured entity from the INSURED box",
  ),
  producer: entityName("The producer (broker/agency) name"),
  carriers: z
    .array(z.string())
    .describe(
      "The insurer names (INSURER A, B, C…) exactly as printed, one entry each. Empty array when unreadable.",
    ),
  certificate_holder: entityName(
    "The certificate holder name from the CERTIFICATE HOLDER box",
  ),
  coverage_lines: z
    .array(coverageLineSchema)
    .describe(
      "One entry per coverage line shown on the certificate (general liability, auto, umbrella, workers' comp, cyber…). Include every line with any limit or policy number.",
    ),
  additional_insured: z
    .boolean()
    .nullable()
    .describe(
      "True when the certificate indicates the certificate holder is an ADDITIONAL INSURED (the ADDL INSD column checked for GL, or the description box says so). False when explicitly not. Null when unstated/unreadable.",
    ),
  waiver_of_subrogation: z
    .boolean()
    .nullable()
    .describe(
      "True when a waiver of subrogation applies (SUBR WVD column checked or stated in the description box). False when explicitly not. Null when unstated.",
    ),
  primary_and_noncontributory: z
    .boolean()
    .nullable()
    .describe(
      "True when the description box states coverage is primary and non-contributory. Null when unstated.",
    ),
  description_of_operations: z
    .string()
    .nullable()
    .describe(
      "The DESCRIPTION OF OPERATIONS box text, transcribed as printed (truncate at ~500 characters). Null when empty.",
    ),
  signature_present: signaturePresent("the authorized-representative block"),
});

const decPageSchema = z.object({
  insured_name: entityName("The named insured"),
  carrier: entityName("The issuing insurance carrier"),
  policy_number: z
    .string()
    .nullable()
    .describe("The policy number exactly as printed."),
  line: z
    .enum(COVERAGE_LINE_VALUES)
    .describe("The line of business this declarations page covers."),
  occurrence_limit_usd: usd("The per-occurrence limit"),
  aggregate_limit_usd: usd("The aggregate limit"),
  effective_date: isoDate("The policy effective date"),
  expiration_date: isoDate("The policy expiration date"),
  endorsements: z
    .array(z.string())
    .describe(
      "Endorsement names/numbers listed on the declarations (e.g. additional insured, waiver of subrogation). Empty array when none are listed.",
    ),
});

const umbrellaSchema = z.object({
  insured_name: entityName("The named insured"),
  carrier: entityName("The issuing insurance carrier"),
  policy_number: z
    .string()
    .nullable()
    .describe("The umbrella/excess policy number exactly as printed."),
  occurrence_limit_usd: usd("The umbrella per-occurrence limit"),
  aggregate_limit_usd: usd("The umbrella aggregate limit"),
  effective_date: isoDate("The policy effective date"),
  expiration_date: isoDate("The policy expiration date"),
  scheduled_underlying_policies: z
    .array(z.string())
    .describe(
      "Policy numbers (or carrier + line descriptions) of the SCHEDULED UNDERLYING policies this umbrella sits over. Empty array when no schedule is shown.",
    ),
  follows_form: z
    .boolean()
    .nullable()
    .describe(
      "True when the policy states it follows form over the underlying policies. Null when unstated.",
    ),
});

const w9Schema = z.object({
  legal_name: entityName(
    "Line 1 — the legal name as shown on the tax return",
  ),
  business_name_dba: entityName(
    "Line 2 — the business/disregarded-entity (DBA) name, when different",
  ),
  tax_classification: z
    .string()
    .nullable()
    .describe(
      "The checked federal tax classification (e.g. 'C Corporation', 'S Corporation', 'LLC (S)', 'Individual/sole proprietor', 'Partnership'). Null when none is checked.",
    ),
  tin_last4: z
    .string()
    .nullable()
    .describe(
      "ONLY the LAST FOUR digits of the TIN (EIN or SSN) from Part I, as a 4-character string. NEVER transcribe the full TIN.",
    ),
  tin_fully_visible: z
    .boolean()
    .nullable()
    .describe(
      "True when the document shows the FULL unmasked TIN (a privacy flag for the reviewer — you still only record the last four digits above).",
    ),
  address_state: z
    .string()
    .nullable()
    .describe("The 2-letter state code from the address block. Null when absent."),
  signature_present: signaturePresent("the Part II certification block"),
  signature_date: isoDate("The signature date from the certification block"),
});

const w8Schema = z.object({
  legal_name: entityName("Line 1 — the name of the organization"),
  country_of_incorporation: z
    .string()
    .nullable()
    .describe("Line 2 — the country of incorporation or organization."),
  chapter3_status: z
    .string()
    .nullable()
    .describe("The checked Chapter 3 status (e.g. 'Corporation'). Null when none."),
  tin_or_giin_last4: z
    .string()
    .nullable()
    .describe(
      "ONLY the LAST FOUR characters of any US TIN or GIIN shown. NEVER the full number.",
    ),
  signature_present: signaturePresent("the certification block"),
  signature_date: isoDate("The signature date"),
});

const businessLicenseSchema = z.object({
  business_name: entityName("The licensed business name"),
  license_number: z
    .string()
    .nullable()
    .describe("The license/registration number exactly as printed."),
  license_type: z
    .string()
    .nullable()
    .describe(
      "The license type/classification as printed (e.g. 'General Contractor — Class A').",
    ),
  jurisdiction_state: z
    .string()
    .nullable()
    .describe(
      "The 2-letter state code of the issuing jurisdiction (derive from the issuing authority when only a city/county is named).",
    ),
  issuing_authority: z
    .string()
    .nullable()
    .describe("The issuing authority as printed (e.g. 'Virginia DPOR')."),
  issue_date: isoDate("The issue date"),
  expiration_date: isoDate("The expiration date"),
});

const diversityCertSchema = z.object({
  business_name: entityName("The certified business name"),
  certifying_body: z
    .string()
    .nullable()
    .describe("The certifying organization (e.g. NMSDC, WBENC, a state UCP, SBA)."),
  certification_type: z
    .string()
    .nullable()
    .describe(
      "The program: MBE, WBE, DBE, VOSB, SDVOSB, 8A, HUBZONE, or the printed program name when different.",
    ),
  certificate_number: z
    .string()
    .nullable()
    .describe("The certificate number exactly as printed."),
  issue_date: isoDate("The issue/effective date"),
  expiration_date: isoDate("The expiration date"),
});

const emrLetterSchema = z.object({
  business_name: entityName("The business the EMR is stated for"),
  emr_value: z
    .number()
    .nullable()
    .describe(
      "The experience modification rate as a decimal (e.g. 0.87). Null when unreadable.",
    ),
  rating_year: z
    .string()
    .nullable()
    .describe("The policy/rating year the EMR applies to (e.g. '2026' or '2025-2026')."),
  issued_by: z
    .string()
    .nullable()
    .describe("Who issued the letter (carrier, agent, or rating bureau such as NCCI)."),
  letter_date: isoDate("The letter date"),
  signature_present: signaturePresent("the letter"),
});

const osha300aSchema = z.object({
  establishment_name: entityName("The establishment name"),
  year: z
    .string()
    .nullable()
    .describe("The calendar year the summary covers (e.g. '2025')."),
  total_deaths: z.number().nullable().describe("Total number of deaths (G)."),
  total_cases_days_away: z
    .number()
    .nullable()
    .describe("Total cases with days away from work (H)."),
  total_recordable_cases: z
    .number()
    .nullable()
    .describe("The sum of recordable cases as stated, when shown."),
  annual_average_employees: z
    .number()
    .nullable()
    .describe("Annual average number of employees, from the employment section."),
  total_hours_worked: z
    .number()
    .nullable()
    .describe("Total hours worked by all employees last year."),
  certified_by_signature: signaturePresent("the company-executive certification block"),
});

const soc2Schema = z.object({
  organization_name: entityName("The service organization the report covers"),
  report_type: z
    .string()
    .nullable()
    .describe("'Type I' or 'Type II' exactly as determinable from the report."),
  period_start: isoDate("The review period start (Type II) or the as-of date (Type I)"),
  period_end: isoDate("The review period end (Type II) or the as-of date (Type I)"),
  auditor: z
    .string()
    .nullable()
    .describe("The independent service auditor (CPA firm) named on the report."),
  opinion: z
    .string()
    .nullable()
    .describe(
      "The auditor's opinion: 'unqualified', 'qualified', 'adverse', or 'disclaimer'. Null when not determinable.",
    ),
  report_date: isoDate("The report issuance date"),
});

const iso27001Schema = z.object({
  organization_name: entityName("The certified organization"),
  certificate_number: z
    .string()
    .nullable()
    .describe("The certificate number exactly as printed."),
  certification_body: z
    .string()
    .nullable()
    .describe("The certification body (e.g. BSI, TÜV, DNV)."),
  issue_date: isoDate("The certificate issue date"),
  expiration_date: isoDate("The certificate expiry date"),
});

const cyberPolicySchema = z.object({
  insured_name: entityName("The named insured"),
  carrier: entityName("The issuing carrier"),
  policy_number: z
    .string()
    .nullable()
    .describe("The policy number exactly as printed."),
  occurrence_limit_usd: usd("The per-claim/occurrence limit"),
  aggregate_limit_usd: usd("The aggregate limit"),
  effective_date: isoDate("The policy effective date"),
  expiration_date: isoDate("The policy expiration date"),
});

const bankLetterSchema = z.object({
  business_name: entityName("The account-holder business name"),
  bank_name: z.string().nullable().describe("The issuing bank's name."),
  account_last4: z
    .string()
    .nullable()
    .describe(
      "ONLY the LAST FOUR digits of the account number, as a 4-character string. NEVER the full number.",
    ),
  letter_date: isoDate("The letter date"),
  signature_present: signaturePresent("the bank officer's block"),
});

const voidCheckSchema = z.object({
  business_name: entityName("The business name printed on the check"),
  bank_name: z.string().nullable().describe("The bank name printed on the check."),
  account_last4: z
    .string()
    .nullable()
    .describe("ONLY the LAST FOUR digits of the account number. NEVER the full number."),
  routing_last4: z
    .string()
    .nullable()
    .describe("ONLY the LAST FOUR digits of the routing number. NEVER the full number."),
  marked_void: z
    .boolean()
    .nullable()
    .describe("True when the check is clearly marked VOID."),
});

const agreementSchema = (agreementKind: string) =>
  z.object({
    party_names: z
      .array(z.string())
      .describe(
        `The named parties to the ${agreementKind}, exactly as printed in the preamble/signature blocks.`,
      ),
    effective_date: isoDate("The agreement effective date"),
    vendor_signature_present: signaturePresent("the vendor party's signature block"),
    counterparty_signature_present: signaturePresent(
      "the buying organization's signature block",
    ),
    signature_date: isoDate("The (latest) signature date"),
  });

// =============================================================================
// SchemaRegistry
// =============================================================================

const EXTRACTION_SCHEMAS: Record<
  Exclude<VendorDocumentType, "UNKNOWN">,
  z.ZodObject<z.ZodRawShape>
> = {
  ACORD_25_COI: acord25Schema,
  INSURANCE_POLICY_DEC_PAGE: decPageSchema,
  UMBRELLA_POLICY: umbrellaSchema,
  W9: w9Schema,
  W8_BEN_E: w8Schema,
  BUSINESS_LICENSE: businessLicenseSchema,
  DIVERSITY_CERT: diversityCertSchema,
  EMR_LETTER: emrLetterSchema,
  OSHA_300A: osha300aSchema,
  SOC2_REPORT: soc2Schema,
  ISO_27001_CERT: iso27001Schema,
  CYBER_POLICY: cyberPolicySchema,
  BANK_LETTER: bankLetterSchema,
  VOID_CHECK: voidCheckSchema,
  MSA_SIGNED: agreementSchema("master services agreement"),
  NDA_SIGNED: agreementSchema("non-disclosure agreement"),
};

const EXTRACTION_SYSTEM_PROMPTS: Partial<
  Record<VendorDocumentType, string>
> = {
  ACORD_25_COI:
    "Extract every coverage line shown on the certificate — general liability, automobile, umbrella/excess, workers' compensation, cyber — one coverage_lines entry each, with its per-occurrence and aggregate limits as plain numbers and its effective/expiration dates. Read the ADDL INSD / SUBR WVD columns and the description-of-operations box for endorsement statements. Transcribe the insured name exactly as printed.",
  W9: "Read the legal name (line 1), DBA (line 2), the checked tax classification, and the Part II certification signature. For the TIN record ONLY the last four digits, and flag tin_fully_visible when the full number is exposed.",
  UMBRELLA_POLICY:
    "Umbrella limits stack over underlying policies: capture the umbrella's own limits AND the schedule of underlying policies (policy numbers or carrier+line descriptions) — the schedule is what confirms the umbrella actually sits over the general-liability policy.",
};

const GENERIC_EXTRACTION_PROMPT =
  "Extract the fields defined by the JSON schema from the document. Use the schema's exact property names; use null for anything unreadable or absent; NEVER invent values; transcribe names, numbers, and dates exactly as printed (dates as YYYY-MM-DD).";

/**
 * The per-type extraction contract handed to the agent by saveClassification
 * (getSchema / getJsonSchema / getSystemPrompt).
 */
export class SchemaRegistry {
  static getSchema(documentType: VendorDocumentType): z.ZodObject<z.ZodRawShape> {
    if (documentType === VendorDocumentTypeEnum.UNKNOWN) {
      return z.object({});
    }
    return EXTRACTION_SCHEMAS[documentType];
  }

  static getJsonSchema(
    documentType: VendorDocumentType,
  ): Record<string, unknown> {
    // zod 4's native converter (flat schemas — no refs emitted); replaces
    // the zod-3-only zod-to-json-schema dependency.
    return z.toJSONSchema(SchemaRegistry.getSchema(documentType)) as Record<
      string,
      unknown
    >;
  }

  static getSystemPrompt(documentType: VendorDocumentType): string {
    const specific = EXTRACTION_SYSTEM_PROMPTS[documentType];
    return specific
      ? `${GENERIC_EXTRACTION_PROMPT} ${specific}`
      : GENERIC_EXTRACTION_PROMPT;
  }
}

// =============================================================================
// Post-classification pure derivations (host-side, model-free)
// =============================================================================

/** The extraction field that carries the vendor-entity name, per type. */
const ENTITY_NAME_FIELD: Partial<Record<VendorDocumentType, string>> = {
  ACORD_25_COI: "insured_name",
  INSURANCE_POLICY_DEC_PAGE: "insured_name",
  UMBRELLA_POLICY: "insured_name",
  CYBER_POLICY: "insured_name",
  W9: "legal_name",
  W8_BEN_E: "legal_name",
  BUSINESS_LICENSE: "business_name",
  DIVERSITY_CERT: "business_name",
  EMR_LETTER: "business_name",
  OSHA_300A: "establishment_name",
  SOC2_REPORT: "organization_name",
  ISO_27001_CERT: "organization_name",
  BANK_LETTER: "business_name",
  VOID_CHECK: "business_name",
};

/** The document-stated entity name, when the type carries one. */
export function deriveVendorEntityName(
  documentType: VendorDocumentType,
  extractedData: Record<string, unknown>,
): string | null {
  const field = ENTITY_NAME_FIELD[documentType];
  if (!field) return null;
  const value = extractedData[field];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** The TIN last-4 the document states, when the type carries one. */
export function deriveTinLast4(
  documentType: VendorDocumentType,
  extractedData: Record<string, unknown>,
): string | null {
  const field =
    documentType === VendorDocumentTypeEnum.W9
      ? "tin_last4"
      : documentType === VendorDocumentTypeEnum.W8_BEN_E
        ? "tin_or_giin_last4"
        : null;
  if (!field) return null;
  const value = extractedData[field];
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * The document's own expiration date (the sweep's per-doc index, written to
 * `vendor_document.extracted_expiration_date` at finalize). For an ACORD 25
 * it is the EARLIEST coverage-line expiration (the certificate stops
 * evidencing anything once any granted line lapses).
 */
export function deriveExtractedExpirationDate(
  documentType: VendorDocumentType,
  extractedData: Record<string, unknown>,
): string | null {
  const asDate = (v: unknown): string | null =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

  if (documentType === VendorDocumentTypeEnum.ACORD_25_COI) {
    const lines = Array.isArray(extractedData.coverage_lines)
      ? (extractedData.coverage_lines as Record<string, unknown>[])
      : [];
    const dates = lines
      .map((line) => asDate(line.expiration_date))
      .filter((d): d is string => d !== null)
      .sort();
    return dates[0] ?? null;
  }
  return asDate(extractedData.expiration_date) ?? asDate(extractedData.period_end);
}

/**
 * PII defense in depth (spec §10): the schemas only ask for last-4 digits,
 * but a model can still transcribe more — enforce the mask at persist time.
 * Mutates known last-4 fields IN PLACE to their final 4 digits.
 */
const LAST4_FIELDS = [
  "tin_last4",
  "tin_or_giin_last4",
  "account_last4",
  "routing_last4",
] as const;

export function enforceMaskedFields(
  extractedData: Record<string, unknown>,
): void {
  for (const field of LAST4_FIELDS) {
    const value = extractedData[field];
    if (typeof value !== "string") continue;
    const digits = value.replace(/\D/g, "");
    extractedData[field] = digits.length >= 4 ? digits.slice(-4) : digits || null;
  }
}

/** Normalize the multi-entity advisory list (dedup, trim, cap). */
export const ADDITIONAL_ENTITY_NAMES_LIMIT = 8;

export function normalizeAdditionalEntityNames(
  names: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= ADDITIONAL_ENTITY_NAMES_LIMIT) break;
  }
  return out;
}
