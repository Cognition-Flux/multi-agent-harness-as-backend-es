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
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { loadPolicy } from "@open-policy-agent/opa-wasm";

import {
  ASSISTANT_PRIVILEGE_VALUES,
  VALIDATORS_BY_DOCUMENT_TYPE,
  REQUIREMENT_CATEGORY_VALUES,
  getPotentialRequirementsForDocumentType,
  listDocumentTypeCatalog,
  DEFAULT_THRESHOLDS,
  type RequirementThresholds,
  type CompanyDocumentPolicy,
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

/**
 * A gate refusal as a typed error (SPEC §23.9). Thrown by callers that must
 * abort on an inadmissible policy; the tRPC errorFormatter surfaces it
 * structurally as `error.data.admission` — findings never travel as
 * JSON-in-a-message-string.
 */
export class AdmissionRefusedError extends Error {
  constructor(
    readonly violations: AdmissionFinding[],
    readonly warnings: AdmissionFinding[],
  ) {
    super("policy inadmissible");
    this.name = "AdmissionRefusedError";
  }
}

export interface ProposedPolicy {
  refereeableCategories: readonly string[];
  /** SPEC §24.1 — omitted means CONVERSATIONAL, the behaviour-preserving default. */
  assistantPrivilege?: string;
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
  return {
    categories: [...REQUIREMENT_CATEGORY_VALUES],
    assistant_privileges: [...ASSISTANT_PRIVILEGE_VALUES],
    document_types: documentTypes,
  };
}

// =============================================================================
// Evaluation
// =============================================================================

type LoadedPolicy = Awaited<ReturnType<typeof loadPolicy>>;

interface AdmissionArtifact {
  regoSha256: string;
  wasmSha256: string;
}

// The PROMISE is cached, not the value: concurrent first calls share one
// readFile+loadPolicy instead of racing, and a rejected load clears the slot so
// a transient failure is never sticky (SPEC §23.11).
let cached: Promise<LoadedPolicy> | null = null;
let artifact: AdmissionArtifact | null = null;
let loadedMtimeMs: number | null = null;
let loadedPath: string | null = null;

async function readWasm(): Promise<{ bytes: Buffer; wasmPath: string }> {
  for (const candidate of WASM_CANDIDATES) {
    try {
      return { bytes: await readFile(candidate), wasmPath: candidate };
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `company-policy.wasm not found (looked in ${WASM_CANDIDATES.join(", ")})`,
  );
}

/**
 * Load the artifact, verifying its bytes against the manifest FIRST (SPEC
 * §23.1): the gate never runs on wasm nobody built. A missing manifest or a
 * hash mismatch fails closed — same posture as `repo.rego`'s
 * G1_admission_wasm_binary_stale, which makes the identical comparison offline.
 */
async function loadVerified(): Promise<LoadedPolicy> {
  const { bytes, wasmPath } = await readWasm();
  const manifestPath = path.join(
    path.dirname(wasmPath),
    "company-policy.wasm.json",
  );
  let manifest: { rego_sha256?: string; wasm_sha256?: string };
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as typeof manifest;
  } catch {
    vendraError("policy.wasm_integrity_failed", {
      reason: "manifest_missing",
      manifestPath,
    });
    throw new Error("company-policy.wasm.json missing — cannot verify the gate artifact");
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (!manifest.wasm_sha256 || manifest.wasm_sha256 !== actual) {
    vendraError("policy.wasm_integrity_failed", {
      reason: "hash_mismatch",
      expected: manifest.wasm_sha256 ?? null,
      actual,
    });
    throw new Error(
      "company-policy.wasm does not hash to its manifest — run `pnpm --filter vendra policy:build`",
    );
  }
  artifact = {
    regoSha256: manifest.rego_sha256 ?? "",
    wasmSha256: manifest.wasm_sha256,
  };
  loadedPath = wasmPath;
  loadedMtimeMs =
    process.env.NODE_ENV === "production"
      ? null
      : (await stat(wasmPath)).mtimeMs;
  return loadPolicy(bytes, undefined, {});
}

/**
 * The hashes the current gate decides under — attached to every
 * `company_policy_decision` row (SPEC §23.8). Null until the first evaluation.
 */
export function admissionArtifact(): AdmissionArtifact | null {
  return artifact;
}

async function getPolicy(): Promise<LoadedPolicy> {
  // Dev only: `policy:build` should take effect without a restart. Prod caches
  // for the process lifetime, as before.
  if (cached && loadedPath && loadedMtimeMs !== null) {
    try {
      if ((await stat(loadedPath)).mtimeMs !== loadedMtimeMs) cached = null;
    } catch {
      cached = null;
    }
  }
  cached ??= loadVerified();
  try {
    return await cached;
  } catch (error) {
    cached = null;
    throw error;
  }
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
  /** Org facts for §24's rules. Callers that omit it (backfill, provisioning)
   *  only ever gate CONVERSATIONAL policies, where officer count is unread. */
  company?: { officerCount: number };
}): Promise<AdmissionDecision> {
  const policyModule = await getPolicy();
  const facts = {
    policy: {
      refereeable_categories: [...input.policy.refereeableCategories],
      // Omitted → CONVERSATIONAL, mirroring the Rego default (§24.1).
      assistant_privilege: input.policy.assistantPrivilege ?? "CONVERSATIONAL",
      documents: input.policy.documents.map((doc) => ({
        document_type: doc.documentType,
        extract_fields: doc.extractFields,
        validators: doc.validators,
      })),
    },
    superset: buildSuperset(),
    profiles: input.profiles,
    // ALWAYS defined: an absent fact silently un-fires the Rego rules that read
    // it — a pass, the failure mode §23.5 exists to refuse.
    company: { officer_count: input.company?.officerCount ?? 0 },
    // Merged over the defaults so a PARTIAL object can never reach Rego with a
    // missing key. The Rego side poisons missing keys to -1 as the backstop —
    // a silently-undefined threshold rule is a pass, the exact failure mode
    // §23.5 refuses.
    thresholds: { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) },
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

