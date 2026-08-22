/**
 * Server side of the governance layer (SPEC §19): loading a company's active
 * policy, and the behaviour-preserving backfill that gives every existing
 * organization one (§19.6).
 *
 * Every database interaction here goes through Drizzle (rule 7). The pure
 * derivations live in `@vendra/workflow/vendor` (`policy.ts`) — this module only
 * reads rows and hands them over.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { getDb, schema, type VendorDb } from "@vendra/db-vendor";
import {
  ASSISTANT_PRIVILEGE_VALUES,
  VALIDATORS_BY_DOCUMENT_TYPE,
  deriveAllowedDocumentTypes,
  extractionFieldNames,
  type AssistantPrivilege,
  type CompanyDocumentPolicy,
  type CompanyPolicy,
  type RequirementCategoryType,
  type RequirementThresholds,
  type VendorDocumentType,
  type VendorValidatorId,
} from "@vendra/workflow/vendor";

import { vendraError, vendraLog, vendraWarn } from "@/server/harness/log";
import { strictestThresholds } from "@/server/profile";
import {
  admissionArtifact,
  evaluateAdmission,
  type AdmissionFinding,
} from "@/server/policy-admission";

const {
  companyPolicy,
  companyPolicyDecision,
  companyPolicyDocument,
  organization,
  vendor,
  vendorActivity,
  vendorRequirementProfile,
} = schema;

type Executor = VendorDb | Parameters<Parameters<VendorDb["transaction"]>[0]>[0];

// =============================================================================
// Read
// =============================================================================

function toCompanyPolicy(
  row: typeof companyPolicy.$inferSelect,
  docRows: (typeof companyPolicyDocument.$inferSelect)[],
): CompanyPolicy {
  // Catalog-drift containment (SPEC §23.6). The gate validated these strings at
  // activation, but an engine upgrade can retire a type or validator AFTER
  // activation — and `VALIDATORS_BY_DOCUMENT_TYPE[retiredType]` is an undefined
  // lookup waiting in the doc lane. Rows whose type left the catalog are
  // dropped (behaviour-neutral: classification only ever emits catalog types);
  // unknown validator ids are inert (no emitted rule carries them) and only
  // counted. Rare by construction, so the warn cannot spam.
  const droppedTypes: string[] = [];
  let unknownValidators = 0;
  const documents: CompanyDocumentPolicy[] = [];
  for (const doc of docRows) {
    if (!(doc.documentType in VALIDATORS_BY_DOCUMENT_TYPE)) {
      droppedTypes.push(doc.documentType);
      continue;
    }
    const known = new Set<string>(
      VALIDATORS_BY_DOCUMENT_TYPE[doc.documentType as VendorDocumentType],
    );
    const validators = (doc.validators ?? []) as VendorValidatorId[];
    unknownValidators += validators.filter((v) => !known.has(v)).length;
    documents.push({
      documentType: doc.documentType as VendorDocumentType,
      extractFields: doc.extractFields ?? [],
      validators,
    });
  }
  if (droppedTypes.length > 0 || unknownValidators > 0) {
    vendraWarn("policy.catalog_drift", {
      policy: row.id,
      droppedTypes: droppedTypes.join(","),
      unknownValidators,
    });
  }
  return {
    id: row.id,
    version: row.version,
    refereeableCategories: (row.refereeableCategories ??
      []) as RequirementCategoryType[],
    assistantPrivilege: (ASSISTANT_PRIVILEGE_VALUES as readonly string[]).includes(
      row.assistantPrivilege,
    )
      ? (row.assistantPrivilege as AssistantPrivilege)
      : "CONVERSATIONAL",
    documents,
  };
}

async function loadPolicyById(policyId: number): Promise<CompanyPolicy | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(companyPolicy)
    .where(eq(companyPolicy.id, policyId))
    .limit(1);
  if (!row) return null;
  const docRows = await db
    .select()
    .from(companyPolicyDocument)
    .where(eq(companyPolicyDocument.companyPolicyId, row.id));
  return toCompanyPolicy(row, docRows);
}

/** The organization's ACTIVE policy version, or null before the first one. */
export async function loadActiveCompanyPolicy(
  organizationId: number,
): Promise<CompanyPolicy | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(companyPolicy)
    .where(
      and(
        eq(companyPolicy.organizationId, organizationId),
        eq(companyPolicy.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!row) return null;
  const docRows = await db
    .select()
    .from(companyPolicyDocument)
    .where(eq(companyPolicyDocument.companyPolicyId, row.id));
  return toCompanyPolicy(row, docRows);
}

/**
 * The id of the organization's ACTIVE policy — what a new vendor gets pinned to.
 *
 * Pinning at creation is what makes §19.3's promise true. Without it the pin
 * stays NULL, `loadVendorCompanyPolicy` falls back to whatever is ACTIVE *now*,
 * and activating a new version silently re-judges vendors mid-onboarding — the
 * exact thing the console's opt-in "apply to existing vendors" exists to avoid.
 */
export async function activeCompanyPolicyId(
  organizationId: number,
): Promise<number | null> {
  const [row] = await getDb()
    .select({ id: companyPolicy.id })
    .from(companyPolicy)
    .where(
      and(
        eq(companyPolicy.organizationId, organizationId),
        eq(companyPolicy.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * The policy a vendor is judged under: the version PINNED on the vendor row,
 * falling back to the org's active one when the pin is absent (a vendor created
 * before the backfill, or between activation and pinning).
 */
export async function loadVendorCompanyPolicy(vendorRow: {
  companyPolicyId: number | null;
  organizationId: number;
}): Promise<CompanyPolicy | null> {
  if (vendorRow.companyPolicyId) {
    const pinned = await loadPolicyById(vendorRow.companyPolicyId);
    if (pinned) return pinned;
  }
  return loadActiveCompanyPolicy(vendorRow.organizationId);
}

// =============================================================================
// Decision records (§23.8)
// =============================================================================

export type PolicyDecisionAction =
  | "CHECK"
  | "ACTIVATE"
  | "ACTIVATE_REFUSED"
  | "PROVISION"
  | "BACKFILL"
  | "DRAFT_SAVE"
  | "DRAFT_DISCARD"
  | "RECHECK"
  | "PROPOSAL_CHECK"
  | "PROPOSAL_APPROVE"
  | "PROPOSAL_REJECT";

/**
 * One `company_policy_decision` row — every gate decision and platform
 * governance action becomes a record, written on the caller's transaction where
 * one exists. Findings hold rule ids and enum-precise details only; officer
 * prose never enters a decision row (the noteLen discipline).
 */
export async function recordPolicyDecision(
  executor: Executor,
  input: {
    organizationId: number;
    action: PolicyDecisionAction;
    actorUserId?: string | null;
    companyPolicyId?: number | null;
    policyVersion?: number | null;
    /** Null/omitted when the gate was not evaluated (draft bookkeeping). */
    admissible?: boolean | null;
    violations?: AdmissionFinding[];
    warnings?: AdmissionFinding[];
    thresholds?: RequirementThresholds | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  const artifact = admissionArtifact();
  await executor.insert(companyPolicyDecision).values({
    organizationId: input.organizationId,
    action: input.action,
    actorUserId: input.actorUserId ?? null,
    companyPolicyId: input.companyPolicyId ?? null,
    policyVersion: input.policyVersion ?? null,
    admissible: input.admissible ?? null,
    violations: input.violations ?? [],
    warnings: input.warnings ?? [],
    thresholds: input.thresholds ?? null,
    regoSha256: artifact?.regoSha256 ?? null,
    wasmSha256: artifact?.wasmSha256 ?? null,
    metadata: input.metadata ?? null,
  });
}

// =============================================================================
// Activation (§19.5) — the one transaction body both activators share
// =============================================================================

/**
 * Archive the current ACTIVE version, flip the admitted draft to ACTIVE, and —
 * only when explicitly asked — re-pin every vendor of the org, writing one
 * `POLICY_ACTIVATED` activity per re-pinned vendor plus the ACTIVATE decision
 * row, all on the caller's transaction. Callers run the admission gate FIRST;
 * this helper never activates an unchecked draft, it just does the writes.
 *
 * Shared by `platform.activatePolicy` and (§24) directive-proposal approval, so
 * both audit identically.
 */
export async function activateCompanyPolicyTx(
  tx: Executor,
  input: {
    organizationId: number;
    draftId: number;
    draftVersion: number;
    userId: string | null;
    applyToExistingVendors: boolean;
    /** The admitting gate decision — its warnings become part of the record. */
    warnings: AdmissionFinding[];
    thresholds: RequirementThresholds;
    metadata?: Record<string, unknown>;
  },
): Promise<{ repinned: number }> {
  await tx
    .update(companyPolicy)
    .set({ status: "ARCHIVED" })
    .where(
      and(
        eq(companyPolicy.organizationId, input.organizationId),
        eq(companyPolicy.status, "ACTIVE"),
      ),
    );
  await tx
    .update(companyPolicy)
    .set({
      status: "ACTIVE",
      activatedAt: new Date(),
      activatedByUserId: input.userId,
    })
    .where(eq(companyPolicy.id, input.draftId));

  let repinned = 0;
  if (input.applyToExistingVendors) {
    const rows = await tx
      .update(vendor)
      .set({ companyPolicyId: input.draftId })
      .where(eq(vendor.organizationId, input.organizationId))
      .returning({ id: vendor.id });
    repinned = rows.length;
    if (rows.length > 0) {
      // Declared in the activity enum since §19, first written here (§23.8):
      // a re-pin re-judges the vendor, and that must show in their ledger.
      await tx.insert(vendorActivity).values(
        rows.map((row) => ({
          vendorId: row.id,
          organizationId: input.organizationId,
          type: "POLICY_ACTIVATED" as const,
          actorUserId: input.userId,
          metadata: { version: input.draftVersion },
        })),
      );
    }
  }

  await recordPolicyDecision(tx, {
    organizationId: input.organizationId,
    action: "ACTIVATE",
    actorUserId: input.userId,
    companyPolicyId: input.draftId,
    policyVersion: input.draftVersion,
    admissible: true,
    warnings: input.warnings,
    thresholds: input.thresholds,
    metadata: { ...(input.metadata ?? {}), repinnedVendors: repinned },
  });
  return { repinned };
}

// =============================================================================
// The behaviour-preserving default (§19.6)
// =============================================================================

/**
 * Today's behaviour, expressed as policy rows:
 *   - accepted types = the UNION of every profile's derived allowlist, so the
 *     per-vendor intersection in `effectiveAllowedDocumentTypes` reproduces the
 *     exact set each vendor had before;
 *   - every field in each type's extraction schema;
 *   - every validator the type can emit (`VALIDATORS_BY_DOCUMENT_TYPE`);
 *   - EVERY required category refereeable. The automated pipeline has always
 *     decided all of them, so full autonomy IS the status quo; an empty list
 *     would refer everything and grant nothing (§19.4).
 */
export function buildDefaultPolicyDocuments(
  profiles: { required: string[] }[],
): CompanyDocumentPolicy[] {
  const accepted = new Set<VendorDocumentType>();
  for (const profile of profiles) {
    for (const type of deriveAllowedDocumentTypes(profile.required ?? [])) {
      if (type !== "UNKNOWN") accepted.add(type);
    }
  }
  return [...accepted].map((documentType) => ({
    documentType,
    extractFields: extractionFieldNames(documentType),
    validators: [...VALIDATORS_BY_DOCUMENT_TYPE[documentType]],
  }));
}

/** Every category any of the org's profiles requires — the default autonomy set. */
export function buildDefaultRefereeableCategories(
  profiles: { required: string[] }[],
): RequirementCategoryType[] {
  const all = new Set<string>();
  for (const profile of profiles) {
    for (const category of profile.required ?? []) all.add(category);
  }
  return [...all] as RequirementCategoryType[];
}

export interface BackfillResult {
  policiesCreated: number;
  vendorsPinned: number;
}

/**
 * Give every organization without one an ACTIVE, behaviour-preserving policy,
 * then pin every unpinned vendor to its org's active policy. Idempotent: an org
 * that already has an ACTIVE policy is skipped, so it is safe to run on every
 * boot alongside the migrations.
 */
export async function backfillCompanyPolicies(): Promise<BackfillResult> {
  const db = getDb();
  const orgs = await db.select({ id: organization.id }).from(organization);
  let policiesCreated = 0;

  for (const org of orgs) {
    const existing = await loadActiveCompanyPolicy(org.id);
    if (existing) continue;

    const profileRows = await db
      .select()
      .from(vendorRequirementProfile)
      .where(eq(vendorRequirementProfile.organizationId, org.id))
      .orderBy(asc(vendorRequirementProfile.id));
    // An org with no requirement profile has nothing to derive a policy FROM,
    // and the gate rightly refuses the empty result ("accepts no document
    // type"). The platform organization is exactly that by design — a tenancy
    // placeholder holding superadmins, never vendors — so skipping is correct
    // rather than a workaround. Without this the whole boot fails as soon as a
    // superadmin exists, which is how it was found.
    if (profileRows.length === 0) {
      vendraLog("policy.backfill_skipped_no_profile", { org: org.id });
      continue;
    }

    const profiles = profileRows.map((row) => ({
      required: row.required,
      mandatory: row.mandatory,
    }));
    const documents = buildDefaultPolicyDocuments(profiles);
    const refereeable = buildDefaultRefereeableCategories(profiles);

    // SPEC §19.5: a policy is activated only if the admission gate admits it.
    // The default is generated from the engines and is proven admissible by the
    // test suite, so a violation here means the GENERATOR is wrong — fail loudly
    // rather than activate something the gate would reject.
    //
    // SPEC §23.2: a gate that cannot RUN fails CLOSED — the org is skipped and
    // no policy row is created, same posture as provisioning and activation.
    // This used to warn-and-proceed, which made the backfill the one path that
    // could activate an unchecked policy for every org at boot. Idempotence
    // makes the skip safe: the next boot retries.
    const thresholds = strictestThresholds(profileRows);
    let decision;
    try {
      decision = await evaluateAdmission({
        policy: { refereeableCategories: refereeable, documents },
        profiles: profiles.map((p) => ({
          required: p.required ?? [],
          mandatory: p.mandatory ?? [],
        })),
        thresholds,
      });
    } catch (err) {
      vendraError("policy.backfill_gate_unavailable", {
        org: org.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!decision.admissible) {
      throw new Error(
        `default policy for organization ${org.id} is inadmissible: ${decision.violations
          .map((v) => `${v.rule} (${v.detail})`)
          .join("; ")}`,
      );
    }

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(companyPolicy)
        .values({
          organizationId: org.id,
          version: 1,
          status: "ACTIVE",
          refereeableCategories: refereeable,
          activatedAt: new Date(),
        })
        .returning({ id: companyPolicy.id });
      if (!row) throw new Error("backfill: company_policy insert returned no row");
      if (documents.length > 0) {
        await tx.insert(companyPolicyDocument).values(
          documents.map((doc) => ({
            companyPolicyId: row.id,
            documentType: doc.documentType,
            extractFields: doc.extractFields,
            validators: doc.validators,
          })),
        );
      }
      await recordPolicyDecision(tx, {
        organizationId: org.id,
        action: "BACKFILL",
        companyPolicyId: row.id,
        policyVersion: 1,
        admissible: true,
        warnings: decision.warnings,
        thresholds,
      });
    });
    policiesCreated++;
  }

  // Pin every vendor that has no policy yet to its org's active version.
  // The correlated subquery in SET has no query-builder equivalent, so this is
  // the rule-7 parameterised `sql` tag exemption — never string-built.
  const pinned = await db
    .update(vendor)
    .set({
      companyPolicyId: sql`(
        select cp.id from ${companyPolicy} cp
        where cp.organization_id = ${vendor.organizationId}
          and cp.status = 'ACTIVE'
        limit 1
      )`,
    })
    .where(isNull(vendor.companyPolicyId))
    .returning({ id: vendor.id });

  const result = { policiesCreated, vendorsPinned: pinned.length };
  vendraLog("policy.backfill", result);
  return result;
}
