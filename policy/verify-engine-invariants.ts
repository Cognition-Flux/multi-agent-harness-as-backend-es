/**
 * Engine invariants the Rego suite cannot express (SPEC §19.2, §19.6, §6.6).
 *
 *   pnpm --filter vendra exec tsx ../../policy/verify-engine-invariants.ts
 *   (or just `bash policy/run-checks.sh`, which runs it)
 *
 * Rego cannot call TypeScript, so the properties that quantify over the ENGINES
 * live here. Every one of these was verified once by an ephemeral script during
 * implementation and then deleted per rule 3 — which left the spec asserting
 * things nothing checked. This file is that gap closed.
 *
 * Needs no database: everything is computed from the pure modules.
 */
import {
  DEFAULT_THRESHOLDS,
  SchemaRegistry,
  VALIDATORS_BY_DOCUMENT_TYPE,
  VENDOR_DOCUMENT_TYPE_VALUES,
  applyValidatorPolicy,
  deriveAllowedDocumentTypes,
  deriveExtractedExpirationDate,
  deriveTinLast4,
  deriveVendorEntityName,
  effectiveAllowedDocumentTypes,
  extractionFieldNames,
  projectExtractedData,
  requiredOccurrenceLimit,
  structuralExtractionFields,
  validateCoverageDetermination,
  validateVendorDocument,
  type CompanyPolicy,
  type SaveCoverageDeterminationInput,
  type VendorDocumentType,
  type VendorValidatorId,
} from "@vendra/workflow/vendor";

let failures = 0;
let checks = 0;
const ok = (name: string) => {
  checks++;
  console.log(`  \x1b[32mok\x1b[0m    ${name}`);
};
const bad = (name: string, detail = "") => {
  checks++;
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? `\n        ${detail}` : ""}`);
};
const head = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const TYPES = (VENDOR_DOCUMENT_TYPE_VALUES as VendorDocumentType[]).filter(
  (t) => t !== "UNKNOWN",
);

const VENDOR_CONTEXT = {
  legalName: "Summit Electrical Contractors LLC",
  dbaName: "Summit Electric",
  tinLast4: "4321",
  workStates: ["TX"],
  buyingOrgName: "Acme Construction Group",
};
const NOW = new Date("2026-08-21T00:00:00Z");

/** Mechanically plausible value per field name — enough to reach most branches. */
function fill(field: string): unknown {
  if (/_date$/.test(field)) return "2027-01-01";
  if (/(usd|limit|amount|rate|emr|score|count|year)/i.test(field)) return 1_000_000;
  if (/^(is_|has_)|(_confirmed|_visible|_signed|_noted)$/.test(field)) return true;
  if (/lines$|_array$|list$|carriers$/.test(field)) return [];
  return VENDOR_CONTEXT.legalName;
}

const coverageLine = (over: Record<string, unknown> = {}) => ({
  line: "GENERAL_LIABILITY",
  occurrence_limit_usd: 1_000_000,
  aggregate_limit_usd: 2_000_000,
  effective_date: "2026-01-01",
  expiration_date: "2027-01-01",
  policy_number: "GL-1",
  carrier: "Acme Ins",
  ...over,
});

/** A spread of inputs per type, aiming to reach both passing and failing branches. */
function inputsFor(type: VendorDocumentType): Record<string, unknown>[] {
  const fields = extractionFieldNames(type);
  const generic = [
    {},
    Object.fromEntries(fields.map((f) => [f, fill(f)])),
    Object.fromEntries(fields.map((f) => [f, null])),
    Object.fromEntries(
      fields.map((f) => [
        f,
        /_date$/.test(f) ? "2019-01-01" : /(usd|limit)/i.test(f) ? 1 : fill(f),
      ]),
    ),
    Object.fromEntries(fields.map((f) => [f, /name/i.test(f) ? "Totally Other Co" : fill(f)])),
  ];
  if (type === "ACORD_25_COI") {
    return [
      {
        insured_name: VENDOR_CONTEXT.legalName,
        producer: "Broker",
        carriers: ["Acme Ins"],
        certificate_holder: VENDOR_CONTEXT.buyingOrgName,
        coverage_lines: [coverageLine()],
        additional_insured: true,
        waiver_of_subrogation: true,
        primary_and_noncontributory: true,
      },
      {
        insured_name: "Totally Other Co",
        producer: "Broker",
        carriers: [],
        certificate_holder: "Someone Else Inc",
        coverage_lines: [coverageLine({ occurrence_limit_usd: 1, expiration_date: "2019-01-01" })],
        additional_insured: false,
        waiver_of_subrogation: null,
        primary_and_noncontributory: null,
      },
      ...generic,
    ];
  }
  if (["INSURANCE_POLICY_DEC_PAGE", "UMBRELLA_POLICY", "CYBER_POLICY"].includes(type)) {
    return [
      { insured_name: VENDOR_CONTEXT.legalName, ...coverageLine() },
      {
        insured_name: VENDOR_CONTEXT.legalName,
        ...coverageLine({ occurrence_limit_usd: 1, expiration_date: "2019-06-01" }),
      },
      ...generic,
    ];
  }
  return generic;
}

// =============================================================================
// SPEC §19.2 — the declared validator map must cover what the engine emits
// =============================================================================

head("§19.2  declared validators cover what the engine emits");
const neverFailing: string[] = [];
for (const type of TYPES) {
  const declared = new Set<string>(VALIDATORS_BY_DOCUMENT_TYPE[type]);
  const emitted = new Set<string>();
  const canFail = new Set<string>();
  for (const input of inputsFor(type)) {
    const res = validateVendorDocument(type, input, VENDOR_CONTEXT, {
      thresholds: DEFAULT_THRESHOLDS,
    }, NOW);
    for (const rule of res?.rules ?? []) {
      emitted.add(rule.validatorId);
      if (!rule.passed && !rule.informational) canFail.add(rule.validatorId);
    }
  }
  const undeclared = [...emitted].filter((id) => !declared.has(id));
  if (undeclared.length > 0) {
    bad(`${type}: emits undeclared validators`, undeclared.join(", "));
  } else {
    ok(`${type}: emitted ⊆ declared (${emitted.size}/${declared.size} reached)`);
  }
  // F4 input: a declared validator that no input can make fail cannot carry the
  // vacuous-truth guard's weight. Reported, not failed — the probe's inputs may
  // simply not reach it.
  for (const id of declared) {
    if (!canFail.has(id)) neverFailing.push(`${type}.${id}`);
  }
}
if (neverFailing.length > 0) {
  console.log(
    `  \x1b[33mnote\x1b[0m  no probe input made these fail (candidates for the` +
      ` §19.5 "at least one FAILABLE validator" rule):\n        ${neverFailing.join(", ")}`,
  );
}

// =============================================================================
// SPEC §19.1 — structural fields are sufficient for every host derivation
// =============================================================================

head("§19.1  structural fields suffice for the host derivations");
for (const type of TYPES) {
  const structural = structuralExtractionFields(type);
  let mismatch = "";
  for (const input of inputsFor(type)) {
    const data = input as Record<string, unknown>;
    // Declared = the full list, so this is a genuine narrowing and actually
    // projects (passing `structural` as declared would short-circuit).
    const only = projectExtractedData(data, structural, structural, extractionFieldNames(type));
    const pairs: [string, unknown, unknown][] = [
      ["entityName", deriveVendorEntityName(type, data), deriveVendorEntityName(type, only)],
      ["expiration", deriveExtractedExpirationDate(type, data), deriveExtractedExpirationDate(type, only)],
      ["tinLast4", deriveTinLast4(type, data), deriveTinLast4(type, only)],
    ];
    for (const [what, full, projected] of pairs) {
      if (JSON.stringify(full) !== JSON.stringify(projected)) {
        mismatch = `${what}: full=${JSON.stringify(full)} structural-only=${JSON.stringify(projected)}`;
        break;
      }
    }
    if (mismatch) break;
  }
  if (mismatch) bad(`${type}: a derivation reads a NON-structural field`, mismatch);
  else ok(`${type}: derivations survive on structural fields alone`);
}

// =============================================================================
// SPEC §19.6 — the default policy is a no-op
// =============================================================================

head("§19.6  the default policy changes nothing");
const defaultDocs = TYPES.map((documentType) => ({
  documentType,
  extractFields: extractionFieldNames(documentType),
  validators: [...VALIDATORS_BY_DOCUMENT_TYPE[documentType]] as VendorValidatorId[],
}));
const defaultPolicy: CompanyPolicy = {
  id: 0,
  version: 0,
  refereeableCategories: [],
  documents: defaultDocs,
};

let noopFailures = 0;
for (const type of TYPES) {
  const doc = defaultDocs.find((d) => d.documentType === type)!;
  for (const input of inputsFor(type)) {
    const base = validateVendorDocument(type, input, VENDOR_CONTEXT, {
      thresholds: DEFAULT_THRESHOLDS,
    }, NOW);
    const narrowed = applyValidatorPolicy(base, doc.validators);
    if (base?.valid !== narrowed?.valid || base?.rules.length !== narrowed?.rules.length) {
      noopFailures++;
      bad(`${type}: narrowing by the full validator set changed the verdict`);
      break;
    }
    const projected = projectExtractedData(
      input as Record<string, unknown>,
      doc.extractFields,
      structuralExtractionFields(type),
      extractionFieldNames(type),
    );
    if (JSON.stringify(projected) !== JSON.stringify(input)) {
      noopFailures++;
      bad(`${type}: projecting onto the full field list dropped data`);
      break;
    }
  }
  const full = Object.keys(SchemaRegistry.getJsonSchema(type).properties ?? {}).sort().join(",");
  const proj = Object.keys(
    SchemaRegistry.getJsonSchema(type, doc.extractFields).properties ?? {},
  ).sort().join(",");
  if (full !== proj) {
    noopFailures++;
    bad(`${type}: the projected extraction contract differs from the full one`);
  }
}
if (noopFailures === 0) ok(`all ${TYPES.length} types: validators, fields and contract unchanged`);

// The allowlist intersection is an identity when the policy accepts everything.
for (const required of [
  ["TAX_IDENTITY", "INSURANCE_GENERAL_LIABILITY"],
  ["TAX_IDENTITY", "DATA_SECURITY", "SIGNED_AGREEMENTS"],
]) {
  const derived = deriveAllowedDocumentTypes(required) as ReadonlySet<VendorDocumentType>;
  const effective = effectiveAllowedDocumentTypes(defaultPolicy, derived);
  const a = [...derived].sort().join(",");
  const b = [...effective].sort().join(",");
  if (a === b) ok(`allowlist unchanged for [${required.join(", ")}]`);
  else bad(`allowlist changed for [${required.join(", ")}]`, `${a} -> ${b}`);
}

// =============================================================================
// SPEC §6.6 — every coherent coverage shape admits a legal verdict
// =============================================================================

head("§6.6  the coverage gates always leave a legal verdict");
{
  const thresholds = DEFAULT_THRESHOLDS;
  const allowed = new Set(["doc-a"]);
  const OCC = [null, 400_000, 500_000, 1_000_000, 2_000_000, 5_000_000];
  const AGG = [null, 1, 500_000, 1_000_000, 2_000_000, 5_000_000];
  const VERDICTS = ["MEETS", "BELOW", "UNDETERMINED"] as const;
  let shapes = 0;
  let unsolvable = 0;
  for (const category of ["GENERAL_LIABILITY", "WORKERS_COMP", "AUTO"] as const) {
    for (const occ of OCC) {
      for (const agg of AGG) {
        // An aggregate below its own occurrence is meant to be rejected outright.
        if (occ !== null && agg !== null && agg < occ) continue;
        shapes++;
        const legal = VERDICTS.filter((verdict) => {
          const payload = {
            lines: [
              {
                category,
                verdict,
                effectiveOccurrenceLimitUsd: occ,
                effectiveAggregateLimitUsd: agg,
                reasoning: "r",
                contributions:
                  occ === null
                    ? []
                    : [
                        {
                          documentUuid: "doc-a",
                          role: "primary" as const,
                          amountAppliedUsd: occ,
                          reasoning: "r",
                        },
                      ],
              },
            ],
            conflicts: [],
            narrative: "n",
          } as unknown as SaveCoverageDeterminationInput;
          return validateCoverageDetermination(payload, allowed, thresholds).ok;
        });
        if (legal.length === 0) {
          unsolvable++;
          bad(`no legal verdict: ${category} occurrence=${occ} aggregate=${agg}`);
        }
      }
    }
  }
  if (unsolvable === 0) ok(`${shapes} coherent shapes, every one solvable`);
  // Sanity: the thresholds the loop assumes are the ones the engine uses.
  if (requiredOccurrenceLimit("GENERAL_LIABILITY", thresholds) !== thresholds.glOccurrenceUsd) {
    bad("requiredOccurrenceLimit disagrees with the thresholds it was given");
  }
}

console.log(
  `\n${failures === 0 ? "\x1b[32m" : "\x1b[31m"}${checks - failures}/${checks} engine invariants held\x1b[0m`,
);
process.exit(failures === 0 ? 0 : 1);
