/**
 * Company onboarding (SPEC §19.5) — the one path that creates a tenant.
 *
 * Used by the superadmin console AND by `pnpm --filter vendra create-company`,
 * because a provisioning flow that only exists behind a UI cannot be exercised
 * end-to-end offline. One implementation, two entry points.
 *
 * Rule 7: every write goes through Drizzle. Rule 8: the officer account is
 * created through the better-auth SDK (`createUserWithRole`), never by raw
 * auth-table inserts.
 *
 * Atomicity follows the §16 B10 contract used by `/api/vendor/register`: the
 * tenant rows land in one transaction, then the account is created, and a
 * failure there compensates by deleting the tenant. better-auth writes on its
 * own connection, so it cannot join our transaction.
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import {
  VALIDATORS_BY_DOCUMENT_TYPE,
  deriveAllowedDocumentTypes,
  extractionFieldNames,
  type RequirementCategoryType,
  type VendorDocumentType,
  type VendorValidatorId,
} from "@vendra/workflow/vendor";

import { COMPLIANCE_OFFICER_ROLE, PLATFORM_ORG_SLUG } from "@/server/auth";
import { createUserWithRole } from "@/server/auth-admin";
import { recordPolicyDecision } from "@/server/company-policy";
import { vendraLog } from "@/server/harness/log";
import { evaluateAdmission } from "@/server/policy-admission";
import { toThresholds } from "@/server/profile";
import { findPreset, type RequirementPreset } from "@/server/requirement-presets";

const { companyPolicy, companyPolicyDocument, organization, vendorRequirementProfile } =
  schema;

// =============================================================================
// The platform organization
// =============================================================================

/**
 * The row a superadmin's `user.organization_id` points at. Idempotent, and
 * deliberately empty of vendors and requirement profiles — it is a tenancy
 * placeholder, not a company.
 */
export async function ensurePlatformOrganization(): Promise<{ id: number }> {
  const db = getDb();
  const [existing] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, PLATFORM_ORG_SLUG))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(organization)
    .values({ name: "Vendra (plataforma)", slug: PLATFORM_ORG_SLUG })
    .returning({ id: organization.id });
  if (!created) throw new Error("platform organization insert returned no row");
  vendraLog("platform.org_created", { org: created.id });
  return created;
}

// =============================================================================
// Provisioning
// =============================================================================

export interface ProvisionCompanyInput {
  name: string;
  slug: string;
  presetId: string;
  /** The company's first compliance officer. Omit to provision the tenant only. */
  officer?: { email: string; password: string; name: string };
  /** The provisioning superadmin, for the decision record. Null from the CLI. */
  actorUserId?: string | null;
}

export interface ProvisionCompanyResult {
  organizationId: number;
  organizationUuid: string;
  profileId: number;
  companyPolicyId: number;
  officerUserId: string | null;
}

export class ProvisioningError extends Error {
  constructor(
    message: string,
    readonly code: "SLUG_TAKEN" | "UNKNOWN_PRESET" | "INADMISSIBLE" | "INVALID",
  ) {
    super(message);
  }
}

/** The behaviour-preserving default policy for a fresh profile (§19.6). */
function defaultPolicyDocuments(preset: RequirementPreset) {
  const accepted = new Set<VendorDocumentType>();
  for (const type of deriveAllowedDocumentTypes(preset.required)) {
    if (type !== "UNKNOWN") accepted.add(type);
  }
  return [...accepted].map((documentType) => ({
    documentType,
    extractFields: extractionFieldNames(documentType),
    validators: [...VALIDATORS_BY_DOCUMENT_TYPE[documentType]] as VendorValidatorId[],
  }));
}

export async function provisionCompany(
  input: ProvisionCompanyInput,
): Promise<ProvisionCompanyResult> {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (name.length < 2) throw new ProvisioningError("El nombre es demasiado corto.", "INVALID");
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) {
    throw new ProvisioningError(
      "El identificador debe tener entre 2 y 49 caracteres: minúsculas, números y guiones.",
      "INVALID",
    );
  }
  if (slug === PLATFORM_ORG_SLUG) {
    throw new ProvisioningError("Ese identificador está reservado.", "SLUG_TAKEN");
  }
  const preset = findPreset(input.presetId);
  if (!preset) throw new ProvisioningError("Perfil de requisitos desconocido.", "UNKNOWN_PRESET");

  const db = getDb();
  const [taken] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);
  if (taken) {
    throw new ProvisioningError("Ya existe una empresa con ese identificador.", "SLUG_TAKEN");
  }

  const documents = defaultPolicyDocuments(preset);
  const refereeable = [...preset.required] as RequirementCategoryType[];

  // SPEC §19.5: nothing is activated without passing the gate — including the
  // policy we generate ourselves. A failure here means the generator is wrong.
  // SPEC §23.4: the PRESET's thresholds ride the call — omitting them silently
  // substituted engine defaults, so a preset with a degenerate threshold sailed
  // through provisioning and only surfaced later.
  const thresholds = toThresholds({ thresholds: preset.thresholds ?? null });
  const admission = await evaluateAdmission({
    policy: { refereeableCategories: refereeable, documents },
    profiles: [{ required: preset.required, mandatory: preset.mandatory }],
    thresholds,
  });
  if (!admission.admissible) {
    throw new ProvisioningError(
      `La política inicial no es admisible: ${admission.violations
        .map((v) => v.detail)
        .join("; ")}`,
      "INADMISSIBLE",
    );
  }

  const created = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organization)
      .values({ name, slug })
      .returning({ id: organization.id, uuid: organization.uuid });
    if (!org) throw new Error("organization insert returned no row");

    const [profile] = await tx
      .insert(vendorRequirementProfile)
      .values({
        organizationId: org.id,
        name: preset.name,
        required: preset.required,
        mandatory: preset.mandatory,
        dismissible: preset.dismissible,
        maxManualDismissable: preset.maxManualDismissable,
        thresholds: preset.thresholds,
      })
      .returning({ id: vendorRequirementProfile.id });
    if (!profile) throw new Error("requirement profile insert returned no row");

    const [policy] = await tx
      .insert(companyPolicy)
      .values({
        organizationId: org.id,
        version: 1,
        status: "ACTIVE",
        refereeableCategories: refereeable,
        activatedAt: new Date(),
      })
      .returning({ id: companyPolicy.id });
    if (!policy) throw new Error("company policy insert returned no row");

    if (documents.length > 0) {
      await tx.insert(companyPolicyDocument).values(
        documents.map((doc) => ({
          companyPolicyId: policy.id,
          documentType: doc.documentType,
          extractFields: doc.extractFields,
          validators: doc.validators,
        })),
      );
    }
    await recordPolicyDecision(tx, {
      organizationId: org.id,
      action: "PROVISION",
      actorUserId: input.actorUserId ?? null,
      companyPolicyId: policy.id,
      policyVersion: 1,
      admissible: true,
      warnings: admission.warnings,
      thresholds,
      metadata: { presetId: preset.id },
    });
    return { org, profileId: profile.id, policyId: policy.id };
  });

  let officerUserId: string | null = null;
  if (input.officer) {
    try {
      const { userId } = await createUserWithRole({
        email: input.officer.email,
        password: input.officer.password,
        name: input.officer.name,
        role: COMPLIANCE_OFFICER_ROLE,
        organizationId: created.org.id,
      });
      officerUserId = userId;
    } catch (err) {
      // Compensating rollback — the §16 B10 contract. A tenant with no officer
      // and a half-created login is worse than no tenant.
      //
      // The message is re-mapped on the way out: better-auth reports a taken
      // address in English ("User already exists. Use another email."), and the
      // console renders whatever it gets, so the raw string surfaced in an
      // otherwise all-Spanish dialog. `createOfficer` already maps it; these two
      // paths do the same act and must speak the same language.
      await db
        .delete(companyPolicy)
        .where(eq(companyPolicy.organizationId, created.org.id))
        .catch(() => undefined);
      await db
        .delete(vendorRequirementProfile)
        .where(eq(vendorRequirementProfile.organizationId, created.org.id))
        .catch(() => undefined);
      await db
        .delete(organization)
        .where(eq(organization.id, created.org.id))
        .catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      if (/exist|taken|unique/i.test(message)) {
        throw new ProvisioningError(
          "Ya existe una cuenta con ese correo.",
          "INVALID",
        );
      }
      throw err;
    }
  }

  vendraLog("platform.company_provisioned", {
    org: created.org.id,
    slug,
    preset: preset.id,
    documents: documents.length,
    officer: officerUserId ? 1 : 0,
  });

  return {
    organizationId: created.org.id,
    organizationUuid: created.org.uuid,
    profileId: created.profileId,
    companyPolicyId: created.policyId,
    officerUserId,
  };
}
