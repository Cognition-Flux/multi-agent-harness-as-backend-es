/**
 * The activation gate (SPEC §19.5): is a proposed company policy admissible?
 *
 * OPA runs HERE and nowhere else. The Rego lives in `policy/company-policy.rego`
 * and is compiled to `policy/company-policy.wasm` by `pnpm --filter vendra
 * policy:build`; this module loads that artifact and evaluates it in-process.
 * No sidecar, no subprocess, no network — and the request path never touches it,
 * because a policy is activated a handful of times per company, ever.
 *
 * The facts handed to Rego are generated from the REAL engines on every call
 * (`listDocumentTypeCatalog`, `VALIDATORS_BY_DOCUMENT_TYPE`,
 * `getPotentialRequirementsForDocumentType`, `structuralExtractionFields`), so
 * this gate cannot pass against a stale copy of the catalog.
 *
 * Verified against the built module: its only host built-in is `sprintf`, which
 * the Node SDK ships — so no `customBuiltins` are required.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadPolicy } from "@open-policy-agent/opa-wasm";

import {
  VALIDATORS_BY_DOCUMENT_TYPE,
  REQUIREMENT_CATEGORY_VALUES,
  extractionFieldNames,
  getPotentialRequirementsForDocumentType,
  listDocumentTypeCatalog,
  structuralExtractionFields,
  DEFAULT_THRESHOLDS,
  type RequirementThresholds,
  type CompanyDocumentPolicy,
  type RequirementCategoryType,
  type VendorDocumentType,
} from "@vendra/workflow/vendor";

import { vendraError, vendraLog } from "@/server/harness/log";

const WASM_ENTRYPOINT = "vendra/policy/admission/decision";

/**
 * Where the artifact can be. First entry is the dev/monorepo layout (cwd is
 * `apps/vendra`); the rest cover the standalone image, where the traced copy
 * lands relative to the server root.
 */
const WASM_CANDIDATES = [
  path.join(process.cwd(), "..", "..", "policy", "company-policy.wasm"),
  path.join(process.cwd(), "policy", "company-policy.wasm"),
  path.join(process.cwd(), "..", "policy", "company-policy.wasm"),
];

export interface AdmissionFinding {
  rule: string;
  detail: string;
}

export interface AdmissionDecision {
  admissible: boolean;
  violations: AdmissionFinding[];
  warnings: AdmissionFinding[];
}

export interface ProposedPolicy {
  refereeableCategories: readonly string[];
  documents: readonly CompanyDocumentPolicy[];
}

export interface AdmissionProfile {
  required: string[];
  mandatory: string[];
}

// =============================================================================
// Facts, generated from the engines
// =============================================================================

function buildSuperset() {
  const documentTypes: Record<string, unknown> = {};
  for (const entry of listDocumentTypeCatalog()) {
    documentTypes[entry.type] = {
      fields: entry.fields,
      structural_fields: entry.structuralFields,
      validators: [...VALIDATORS_BY_DOCUMENT_TYPE[entry.type]],
      categories: getPotentialRequirementsForDocumentType(entry.type),
    };
  }
  return { categories: [...REQUIREMENT_CATEGORY_VALUES], document_types: documentTypes };
}

// =============================================================================
// Evaluation
// =============================================================================

type LoadedPolicy = Awaited<ReturnType<typeof loadPolicy>>;
let cached: LoadedPolicy | null = null;

async function readWasm(): Promise<Buffer> {
  for (const candidate of WASM_CANDIDATES) {
    try {
      return await readFile(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `company-policy.wasm not found (looked in ${WASM_CANDIDATES.join(", ")})`,
  );
}

async function getPolicy(): Promise<LoadedPolicy> {
  if (cached) return cached;
  const wasm = await readWasm();
  cached = await loadPolicy(wasm, undefined, {});
  return cached;
}

/**
 * Evaluate admissibility. Throws only when the artifact itself is missing or
 * unloadable — a policy the gate REJECTS returns `admissible: false` with the
 * reasons, which is a normal outcome the console renders.
 */
export async function evaluateAdmission(input: {
  policy: ProposedPolicy;
  profiles: AdmissionProfile[];
  /** The org's validation thresholds — a zero floor makes a validator unsatisfiable. */
  thresholds?: RequirementThresholds;
}): Promise<AdmissionDecision> {
  const policyModule = await getPolicy();
  const facts = {
    policy: {
      refereeable_categories: [...input.policy.refereeableCategories],
      documents: input.policy.documents.map((doc) => ({
        document_type: doc.documentType,
        extract_fields: doc.extractFields,
        validators: doc.validators,
      })),
    },
    superset: buildSuperset(),
    profiles: input.profiles,
    thresholds: input.thresholds ?? DEFAULT_THRESHOLDS,
  };

  const resultSet = policyModule.evaluate(facts, WASM_ENTRYPOINT) as
    | { result?: AdmissionDecision }[]
    | undefined;
  // Hard rule 1 of the OPA skill: an EMPTY result set means undefined, not
  // false. Treating it as "admissible" would wave every policy through, so it
  // is an error, never a pass.
  const decision = resultSet?.[0]?.result;
  if (!decision) {
    vendraError("policy.admission_undefined", { entrypoint: WASM_ENTRYPOINT });
    throw new Error("admissibility policy returned no decision");
  }
  vendraLog("policy.admission", {
    admissible: decision.admissible,
    violations: decision.violations?.length ?? 0,
    warnings: decision.warnings?.length ?? 0,
  });
  return {
    admissible: decision.admissible,
    violations: decision.violations ?? [],
    warnings: decision.warnings ?? [],
  };
}

/** Fields a company may choose from for a type, with the locked ones marked. */
export function selectableFields(documentType: VendorDocumentType): {
  field: string;
  structural: boolean;
}[] {
  const structural = new Set(structuralExtractionFields(documentType));
  return extractionFieldNames(documentType).map((field) => ({
    field,
    structural: structural.has(field),
  }));
}

/** Categories a set of accepted document types can grant. */
export function grantableCategories(
  documents: readonly CompanyDocumentPolicy[],
): RequirementCategoryType[] {
  const out = new Set<RequirementCategoryType>();
  for (const doc of documents) {
    for (const category of getPotentialRequirementsForDocumentType(doc.documentType)) {
      out.add(category);
    }
  }
  return [...out];
}
