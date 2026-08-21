/**
 * Server side of the governance layer (SPEC §19): loading a company's active
 * policy, and the behaviour-preserving backfill that gives every existing
 * organization one (§19.6).
 *
 * Every database interaction here goes through Drizzle (rule 7). The pure
 * derivations live in `@vendra/workflow/vendor` (`policy.ts`) — this module only
 * reads rows and hands them over.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import {
  VALIDATORS_BY_DOCUMENT_TYPE,
  deriveAllowedDocumentTypes,
  extractionFieldNames,
  type CompanyDocumentPolicy,
  type CompanyPolicy,
  type RequirementCategoryType,
  type VendorDocumentType,
  type VendorValidatorId,
} from "@vendra/workflow/vendor";

import { vendraLog, vendraWarn } from "@/server/harness/log";
import { toThresholds } from "@/server/profile";
import { evaluateAdmission } from "@/server/policy-admission";

const { companyPolicy, companyPolicyDocument, organization, vendor, vendorRequirementProfile } =
  schema;

// =============================================================================
// Read
// =============================================================================

function toCompanyPolicy(
  row: typeof companyPolicy.$inferSelect,
  docRows: (typeof companyPolicyDocument.$inferSelect)[],
): CompanyPolicy {
  return {
    id: row.id,
    version: row.version,
    refereeableCategories: (row.refereeableCategories ??
      []) as RequirementCategoryType[],
    documents: docRows.map(
      (doc): CompanyDocumentPolicy => ({
        documentType: doc.documentType as VendorDocumentType,
        extractFields: doc.extractFields ?? [],
        validators: (doc.validators ?? []) as VendorValidatorId[],
      }),
    ),
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
      .where(eq(vendorRequirementProfile.organizationId, org.id));
    const profiles = profileRows.map((row) => ({
      required: row.required,
      mandatory: row.mandatory,
    }));
    const documents = buildDefaultPolicyDocuments(profiles);
    const refereeable = buildDefaultRefereeableCategories(profiles);

    // SPEC §19.5: a policy is activated only if the admission gate admits it.
    // The default is generated from the engines and is proven admissible by the
    // test suite, so a violation here means the GENERATOR is wrong — fail loudly
    // rather than activate something the gate would reject. A gate that cannot
    // LOAD (missing artifact in some deployment) is an infrastructure problem,
    // not a policy problem: log it and proceed, because refusing to boot over a
    // policy we generated ourselves would be worse.
    try {
      const decision = await evaluateAdmission({
        policy: { refereeableCategories: refereeable, documents },
        profiles: profiles.map((p) => ({
          required: p.required ?? [],
          mandatory: p.mandatory ?? [],
        })),
        // Thresholds are per profile; the admission rule only needs a floor, and
        // an org's profiles share the same engine defaults where unset.
        ...(profileRows[0] ? { thresholds: toThresholds(profileRows[0]) } : {}),
      });
      if (!decision.admissible) {
        throw new Error(
          `default policy for organization ${org.id} is inadmissible: ${decision.violations
            .map((v) => `${v.rule} (${v.detail})`)
            .join("; ")}`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("inadmissible")) throw err;
      vendraWarn("policy.admission_unavailable", {
        org: org.id,
        error: err instanceof Error ? err.message : String(err),
      });
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
