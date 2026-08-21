/**
 * The superadmin (platform) tRPC surface — SPEC §19.5.
 *
 * Mounted as `platform.*` on the app router and built exclusively on
 * `superadminProcedure`, which injects NO organization scope. That is the whole
 * point of this file and also its main hazard, so every procedure here resolves
 * its target organization from an explicit uuid and never from ambient state.
 * The platform organization itself is never a target: it owns no vendors and no
 * profiles, and listing it as a "company" would invite someone to configure it.
 *
 * Rule 7: all reads and writes go through Drizzle.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@vendra/db-vendor";
import {
  REQUIREMENT_CATEGORY_VALUES,
  VALIDATORS_BY_DOCUMENT_TYPE,
  extractionFieldNames,
  getPotentialRequirementsForDocumentType,
  listDocumentTypeCatalog,
  listValidatorCatalog,
  requirementCategoryLabel,
  structuralExtractionFields,
  type RequirementCategoryType,
  type VendorDocumentType,
  type VendorValidatorId,
} from "@vendra/workflow/vendor";

import { COMPLIANCE_OFFICER_ROLE, PLATFORM_ORG_SLUG } from "@/server/auth";
import { createUserWithRole } from "@/server/auth-admin";
import {
  ProvisioningError,
  provisionCompany,
} from "@/server/company-provisioning";
import { vendraLog } from "@/server/harness/log";
import { evaluateAdmission } from "@/server/policy-admission";
import { toThresholds } from "@/server/profile";
import { REQUIREMENT_PRESETS } from "@/server/requirement-presets";

import { router, superadminProcedure } from "./init";

const {
  companyPolicy,
  companyPolicyDocument,
  organization,
  user,
  vendor,
  vendorRequirementProfile,
} = schema;

// =============================================================================
// Shared resolution
// =============================================================================

/** Resolve a target company by uuid. The platform org is never a valid target. */
async function resolveCompany(uuid: string) {
  const [org] = await getDb()
    .select()
    .from(organization)
    .where(and(eq(organization.uuid, uuid), ne(organization.slug, PLATFORM_ORG_SLUG)))
    .limit(1);
  if (!org) throw new TRPCError({ code: "NOT_FOUND" });
  return org;
}

const documentPolicyInput = z.object({
  documentType: z.string().min(1).max(64),
  extractFields: z.array(z.string().min(1).max(120)).max(200),
  validators: z.array(z.string().min(1).max(64)).max(40),
});

async function loadPolicyWithDocuments(policyId: number) {
  const db = getDb();
  const docs = await db
    .select()
    .from(companyPolicyDocument)
    .where(eq(companyPolicyDocument.companyPolicyId, policyId))
    .orderBy(asc(companyPolicyDocument.documentType));
  return docs.map((doc) => ({
    documentType: doc.documentType as VendorDocumentType,
    extractFields: doc.extractFields ?? [],
    validators: (doc.validators ?? []) as VendorValidatorId[],
  }));
}

// =============================================================================
// The router
// =============================================================================

export const platformRouter = router({
  /** Everything the policy builder needs to render, straight from the engines. */
  catalog: superadminProcedure.query(() => ({
    documentTypes: listDocumentTypeCatalog().map((entry) => ({
      type: entry.type,
      title: entry.title,
      displayName: entry.displayName,
      fields: entry.fields,
      structuralFields: entry.structuralFields,
      validators: [...VALIDATORS_BY_DOCUMENT_TYPE[entry.type]],
      grants: getPotentialRequirementsForDocumentType(entry.type),
    })),
    validators: listValidatorCatalog(),
    categories: REQUIREMENT_CATEGORY_VALUES.map((category) => ({
      category,
      label: requirementCategoryLabel(category),
    })),
    presets: REQUIREMENT_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      requiredCount: preset.required.length,
    })),
  })),

  listCompanies: superadminProcedure.query(async () => {
    const db = getDb();
    const orgs = await db
      .select()
      .from(organization)
      .where(ne(organization.slug, PLATFORM_ORG_SLUG))
      .orderBy(asc(organization.name));

    // Small N (companies, not vendors) — a per-org rollup is clearer here than
    // one wide join, and it keeps each count independently correct.
    return Promise.all(
      orgs.map(async (org) => {
        const [[vendors], [officers], [profiles], activePolicy] = await Promise.all([
          db
            .select({ n: count() })
            .from(vendor)
            .where(eq(vendor.organizationId, org.id)),
          // Officers specifically, not all accounts: a company that has vendor
          // contacts but nobody to adjudicate them is exactly the state the
          // roster needs to surface.
          db
            .select({ n: count() })
            .from(user)
            .where(
              and(
                eq(user.organizationId, org.id),
                eq(user.role, COMPLIANCE_OFFICER_ROLE),
              ),
            ),
          db
            .select({ n: count() })
            .from(vendorRequirementProfile)
            .where(eq(vendorRequirementProfile.organizationId, org.id)),
          db
            .select()
            .from(companyPolicy)
            .where(
              and(
                eq(companyPolicy.organizationId, org.id),
                eq(companyPolicy.status, "ACTIVE"),
              ),
            )
            .limit(1),
        ]);
        const policy = activePolicy[0];
        const [docCount] = policy
          ? await db
              .select({ n: count() })
              .from(companyPolicyDocument)
              .where(eq(companyPolicyDocument.companyPolicyId, policy.id))
          : [{ n: 0 }];
        const [draft] = await db
          .select({ id: companyPolicy.id, version: companyPolicy.version })
          .from(companyPolicy)
          .where(
            and(
              eq(companyPolicy.organizationId, org.id),
              eq(companyPolicy.status, "DRAFT"),
            ),
          )
          .limit(1);
        return {
          uuid: org.uuid,
          name: org.name,
          slug: org.slug,
          createdAt: org.createdAt.toISOString(),
          vendorCount: vendors?.n ?? 0,
          officerCount: officers?.n ?? 0,
          profileCount: profiles?.n ?? 0,
          policy: policy
            ? {
                version: policy.version,
                acceptedDocumentTypes: docCount?.n ?? 0,
                refereeableCategories: policy.refereeableCategories?.length ?? 0,
                activatedAt: policy.activatedAt?.toISOString() ?? null,
              }
            : null,
          hasDraft: !!draft,
        };
      }),
    );
  }),

  getCompany: superadminProcedure
    .input(z.object({ uuid: z.string().uuid() }))
    .query(async ({ input }) => {
      const org = await resolveCompany(input.uuid);
      const db = getDb();
      const profiles = await db
        .select()
        .from(vendorRequirementProfile)
        .where(eq(vendorRequirementProfile.organizationId, org.id))
        .orderBy(asc(vendorRequirementProfile.id));
      const policies = await db
        .select()
        .from(companyPolicy)
        .where(eq(companyPolicy.organizationId, org.id))
        .orderBy(asc(companyPolicy.version));
      const active = policies.find((p) => p.status === "ACTIVE") ?? null;
      const draft = policies.find((p) => p.status === "DRAFT") ?? null;
      const [vendors] = await db
        .select({ n: count() })
        .from(vendor)
        .where(eq(vendor.organizationId, org.id));
      // The company's own logins. A company with no officer cannot adjudicate
      // anything, so the console shows this rather than leaving it to be
      // discovered when nobody can sign in.
      const accounts = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(eq(user.organizationId, org.id))
        .orderBy(asc(user.createdAt));

      return {
        uuid: org.uuid,
        name: org.name,
        slug: org.slug,
        vendorCount: vendors?.n ?? 0,
        officers: accounts
          .filter((a) => a.role === COMPLIANCE_OFFICER_ROLE)
          .map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email,
            createdAt: a.createdAt.toISOString(),
          })),
        vendorContactCount: accounts.filter((a) => a.role !== COMPLIANCE_OFFICER_ROLE)
          .length,
        profiles: profiles.map((p) => ({
          id: p.id,
          name: p.name,
          required: p.required,
          mandatory: p.mandatory,
          dismissible: p.dismissible,
          maxManualDismissable: p.maxManualDismissable,
          thresholds: toThresholds(p),
        })),
        active: active
          ? {
              id: active.id,
              version: active.version,
              refereeableCategories: (active.refereeableCategories ??
                []) as RequirementCategoryType[],
              activatedAt: active.activatedAt?.toISOString() ?? null,
              documents: await loadPolicyWithDocuments(active.id),
            }
          : null,
        draft: draft
          ? {
              id: draft.id,
              version: draft.version,
              refereeableCategories: (draft.refereeableCategories ??
                []) as RequirementCategoryType[],
              documents: await loadPolicyWithDocuments(draft.id),
            }
          : null,
        versions: policies.map((p) => ({
          version: p.version,
          status: p.status,
          activatedAt: p.activatedAt?.toISOString() ?? null,
        })),
      };
    }),

  provisionCompany: superadminProcedure
    .input(
      z.object({
        name: z.string().min(2).max(160),
        slug: z.string().min(2).max(49),
        presetId: z.string().min(1).max(64),
        officer: z
          .object({
            email: z.string().email().max(200),
            // better-auth's policy; surfaced here so the console can say why.
            password: z.string().min(8).max(128),
            name: z.string().min(2).max(160),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await provisionCompany(input);
        vendraLog("platform.provisioned_via_console", {
          by: ctx.user.id,
          org: result.organizationId,
        });
        return result;
      } catch (err) {
        if (err instanceof ProvisioningError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Write the working copy. Never touches the ACTIVE row — a company keeps
   * being judged by its activated policy until someone activates a new version.
   */
  /**
   * Add a compliance officer to an existing company.
   *
   * The provisioning dialog can create the first one, but making that the ONLY
   * path leaves a company provisioned without an officer permanently unusable
   * from the console. Same contract as everywhere else: the account is created
   * through the better-auth SDK (rule 8), never by writing auth tables.
   */
  createOfficer: superadminProcedure
    .input(
      z.object({
        uuid: z.string().uuid(),
        name: z.string().min(2).max(120),
        email: z.string().email().max(200),
        password: z.string().min(8).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await resolveCompany(input.uuid);
      try {
        const { userId } = await createUserWithRole({
          email: input.email,
          password: input.password,
          name: input.name,
          role: COMPLIANCE_OFFICER_ROLE,
          organizationId: org.id,
        });
        vendraLog("platform.officer_created", {
          by: ctx.user.id,
          org: org.id,
          user: userId,
        });
        return { userId };
      } catch (err) {
        // better-auth reports a taken address as its own error; anything else
        // is unexpected and should not be dressed up as a validation problem.
        const message = err instanceof Error ? err.message : String(err);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: /exist|taken|unique/i.test(message)
            ? "Ya existe una cuenta con ese correo."
            : "No se pudo crear la cuenta.",
        });
      }
    }),

  savePolicyDraft: superadminProcedure
    .input(
      z.object({
        uuid: z.string().uuid(),
        refereeableCategories: z.array(z.string().min(1).max(64)).max(32),
        documents: z.array(documentPolicyInput).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await resolveCompany(input.uuid);
      const db = getDb();
      return db.transaction(async (tx) => {
        const [existingDraft] = await tx
          .select()
          .from(companyPolicy)
          .where(
            and(
              eq(companyPolicy.organizationId, org.id),
              eq(companyPolicy.status, "DRAFT"),
            ),
          )
          .limit(1);

        let draftId: number;
        let version: number;
        if (existingDraft) {
          draftId = existingDraft.id;
          version = existingDraft.version;
          await tx
            .update(companyPolicy)
            .set({
              refereeableCategories: input.refereeableCategories,
            })
            .where(eq(companyPolicy.id, draftId));
          await tx
            .delete(companyPolicyDocument)
            .where(eq(companyPolicyDocument.companyPolicyId, draftId));
        } else {
          const [{ maxVersion }] = await tx
            .select({ maxVersion: sql<number>`coalesce(max(${companyPolicy.version}), 0)` })
            .from(companyPolicy)
            .where(eq(companyPolicy.organizationId, org.id));
          version = Number(maxVersion) + 1;
          const [created] = await tx
            .insert(companyPolicy)
            .values({
              organizationId: org.id,
              version,
              status: "DRAFT",
              refereeableCategories: input.refereeableCategories,
              createdByUserId: ctx.user.id,
            })
            .returning({ id: companyPolicy.id });
          if (!created) throw new Error("draft insert returned no row");
          draftId = created.id;
        }

        if (input.documents.length > 0) {
          await tx.insert(companyPolicyDocument).values(
            input.documents.map((doc) => ({
              companyPolicyId: draftId,
              documentType: doc.documentType,
              extractFields: doc.extractFields,
              validators: doc.validators,
            })),
          );
        }
        return { draftId, version };
      });
    }),

  /** Dry-run the activation gate without writing anything. */
  checkPolicyDraft: superadminProcedure
    .input(
      z.object({
        uuid: z.string().uuid(),
        refereeableCategories: z.array(z.string().min(1).max(64)).max(32),
        documents: z.array(documentPolicyInput).max(64),
      }),
    )
    .mutation(async ({ input }) => {
      const org = await resolveCompany(input.uuid);
      const db = getDb();
      const profiles = await db
        .select()
        .from(vendorRequirementProfile)
        .where(eq(vendorRequirementProfile.organizationId, org.id));
      return evaluateAdmission({
        policy: {
          refereeableCategories: input.refereeableCategories,
          documents: input.documents.map((doc) => ({
            documentType: doc.documentType as VendorDocumentType,
            extractFields: doc.extractFields,
            validators: doc.validators as VendorValidatorId[],
          })),
        },
        profiles: profiles.map((p) => ({
          required: p.required,
          mandatory: p.mandatory,
        })),
        ...(profiles[0] ? { thresholds: toThresholds(profiles[0]) } : {}),
      });
    }),

  /**
   * Activate the draft. Refused unless the admission gate admits it.
   *
   * `applyToExistingVendors` is opt-in and off by default: a vendor is PINNED to
   * the version it is being judged under (§19.3), so activation normally governs
   * new vendors only and never re-judges someone mid-onboarding. Re-pinning is a
   * deliberate act with visible consequences, so the console asks for it
   * explicitly.
   */
  activatePolicy: superadminProcedure
    .input(
      z.object({
        uuid: z.string().uuid(),
        applyToExistingVendors: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await resolveCompany(input.uuid);
      const db = getDb();
      const [draft] = await db
        .select()
        .from(companyPolicy)
        .where(
          and(
            eq(companyPolicy.organizationId, org.id),
            eq(companyPolicy.status, "DRAFT"),
          ),
        )
        .limit(1);
      if (!draft) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No hay un borrador para activar.",
        });
      }
      const documents = await loadPolicyWithDocuments(draft.id);
      const profiles = await db
        .select()
        .from(vendorRequirementProfile)
        .where(eq(vendorRequirementProfile.organizationId, org.id));

      const decision = await evaluateAdmission({
        policy: {
          refereeableCategories: (draft.refereeableCategories ?? []) as string[],
          documents,
        },
        profiles: profiles.map((p) => ({
          required: p.required,
          mandatory: p.mandatory,
        })),
        ...(profiles[0] ? { thresholds: toThresholds(profiles[0]) } : {}),
      });
      if (!decision.admissible) {
        // The gate's reasons ARE the error — the console renders them all.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: JSON.stringify(decision.violations),
        });
      }

      const repinned = await db.transaction(async (tx) => {
        await tx
          .update(companyPolicy)
          .set({ status: "ARCHIVED" })
          .where(
            and(
              eq(companyPolicy.organizationId, org.id),
              eq(companyPolicy.status, "ACTIVE"),
            ),
          );
        await tx
          .update(companyPolicy)
          .set({
            status: "ACTIVE",
            activatedAt: new Date(),
            activatedByUserId: ctx.user.id,
          })
          .where(eq(companyPolicy.id, draft.id));

        if (!input.applyToExistingVendors) return 0;
        const rows = await tx
          .update(vendor)
          .set({ companyPolicyId: draft.id })
          .where(eq(vendor.organizationId, org.id))
          .returning({ id: vendor.id });
        return rows.length;
      });

      vendraLog("platform.policy_activated", {
        by: ctx.user.id,
        org: org.id,
        version: draft.version,
        repinnedVendors: repinned,
        warnings: decision.warnings.length,
      });
      return { version: draft.version, repinnedVendors: repinned, warnings: decision.warnings };
    }),

  discardPolicyDraft: superadminProcedure
    .input(z.object({ uuid: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const org = await resolveCompany(input.uuid);
      // Documents cascade on the FK, so deleting the draft row is enough.
      const deleted = await getDb()
        .delete(companyPolicy)
        .where(
          and(
            eq(companyPolicy.organizationId, org.id),
            eq(companyPolicy.status, "DRAFT"),
          ),
        )
        .returning({ id: companyPolicy.id });
      return { discarded: deleted.length };
    }),

  /** Seed-parity helper: the fields a type can offer, with the locked ones marked. */
  documentFields: superadminProcedure
    .input(z.object({ documentType: z.string().min(1).max(64) }))
    .query(({ input }) => {
      const type = input.documentType as VendorDocumentType;
      const structural = new Set(structuralExtractionFields(type));
      return extractionFieldNames(type).map((field) => ({
        field,
        structural: structural.has(field),
      }));
    }),
});
