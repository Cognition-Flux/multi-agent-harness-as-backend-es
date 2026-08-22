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
import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@vendra/db-vendor";
import {
  ASSISTANT_PRIVILEGE_VALUES,
  REQUIREMENT_CATEGORY_VALUES,
  VALIDATORS_BY_DOCUMENT_TYPE,
  VENDOR_VALIDATOR_ID_VALUES,
  VendorDocumentTypeEnum,
  extractionFieldNames,
  getPotentialRequirementsForDocumentType,
  listDocumentTypeCatalog,
  listValidatorCatalog,
  requirementCategoryLabel,
  structuralExtractionFields,
  type AssistantPrivilege,
  type DirectiveDiff,
  type RequirementCategoryType,
  type VendorDocumentType,
  type VendorValidatorId,
} from "@vendra/workflow/vendor";

import { clearAssistantSessionStatesForOrg } from "@/server/assistant/store";
import { COMPLIANCE_OFFICER_ROLE, PLATFORM_ORG_SLUG } from "@/server/auth";
import { createUserWithRole } from "@/server/auth-admin";
import {
  activateCompanyPolicyTx,
  recordPolicyDecision,
} from "@/server/company-policy";
import {
  ProvisioningError,
  provisionCompany,
} from "@/server/company-provisioning";
import {
  countOpenProposalsByOrg,
  listProposalsForOrg,
  resolveProposalTx,
  supersedeOpenProposalsForOrgTx,
  type ProposedPolicySnapshot,
} from "@/server/directive-proposals";
import { vendraError, vendraLog } from "@/server/harness/log";
import {
  consolidateDirectiveOutcome,
  summarizeDirectiveDiffLines,
} from "@/server/memory/directives";
import {
  AdmissionRefusedError,
  evaluateAdmission,
} from "@/server/policy-admission";
import { strictestThresholds, toThresholds } from "@/server/profile";
import { REQUIREMENT_PRESETS } from "@/server/requirement-presets";

import { router, superadminProcedure } from "./init";

const {
  companyPolicy,
  companyPolicyDocument,
  directiveProposal,
  organization,
  user,
  vendor,
  vendorRequirementProfile,
} = schema;

/** Officers are the approver pool §24.4's gate rule counts. */
async function officerCountFor(organizationId: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(user)
    .where(
      and(
        eq(user.organizationId, organizationId),
        eq(user.role, COMPLIANCE_OFFICER_ROLE),
      ),
    );
  return row?.n ?? 0;
}

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

// Shape-gated at the edge (SPEC §23.7): types and validators come from the
// engine vocabularies, so garbage never reaches the DB — previously a duplicate
// documentType 500'd on company_policy_document_uq and an unknown string
// persisted a draft only the gate could refuse. The OPA gate stays the sole
// authority on ADMISSIBILITY; zod only refuses malformed shapes. extractFields
// stays string-typed — unknown fields are the gate's `unknown_field` job.
const SELECTABLE_DOCUMENT_TYPES = Object.values(VendorDocumentTypeEnum).filter(
  (type) => type !== "UNKNOWN",
) as [VendorDocumentType, ...VendorDocumentType[]];

const documentPolicyInput = z.object({
  documentType: z.enum(SELECTABLE_DOCUMENT_TYPES),
  extractFields: z.array(z.string().min(1).max(120)).max(200),
  validators: z.array(z.enum(VENDOR_VALIDATOR_ID_VALUES)).max(40),
});

const policyDraftFields = {
  uuid: z.string().uuid(),
  refereeableCategories: z.array(z.enum(REQUIREMENT_CATEGORY_VALUES)).max(32),
  /** SPEC §24.1 — defaulted so pre-§24 console payloads stay valid. */
  assistantPrivilege: z
    .enum(ASSISTANT_PRIVILEGE_VALUES)
    .default("CONVERSATIONAL"),
  documents: z
    .array(documentPolicyInput)
    .max(64)
    .superRefine((docs, ctx) => {
      const seen = new Set<string>();
      for (const doc of docs) {
        if (seen.has(doc.documentType)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Tipo de documento duplicado en la política: ${doc.documentType}.`,
          });
        }
        seen.add(doc.documentType);
      }
    }),
};

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
    // SPEC §24.1 — the tier vocabulary, engine-derived like everything else.
    assistantPrivileges: ASSISTANT_PRIVILEGE_VALUES.map((value) => ({
      value,
      label:
        value === "EMPOWERED"
          ? "Delegado — puede proponer directivas"
          : "Conversacional — solo explica",
    })),
  })),

  listCompanies: superadminProcedure.query(async () => {
    const db = getDb();
    const orgs = await db
      .select()
      .from(organization)
      .where(ne(organization.slug, PLATFORM_ORG_SLUG))
      .orderBy(asc(organization.name));
    const openProposals = await countOpenProposalsByOrg();

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
                assistantPrivilege: policy.assistantPrivilege as AssistantPrivilege,
                activatedAt: policy.activatedAt?.toISOString() ?? null,
              }
            : null,
          hasDraft: !!draft,
          openProposalCount: openProposals.get(org.id) ?? 0,
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
              assistantPrivilege: active.assistantPrivilege as AssistantPrivilege,
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
              assistantPrivilege: draft.assistantPrivilege as AssistantPrivilege,
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
        const result = await provisionCompany({ ...input, actorUserId: ctx.user.id });
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
    .input(z.object(policyDraftFields))
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
              assistantPrivilege: input.assistantPrivilege,
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
              assistantPrivilege: input.assistantPrivilege,
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
        await recordPolicyDecision(tx, {
          organizationId: org.id,
          action: "DRAFT_SAVE",
          actorUserId: ctx.user.id,
          companyPolicyId: draftId,
          policyVersion: version,
        });
        return { draftId, version };
      });
    }),

  /** Dry-run the activation gate; writes nothing but the decision record. */
  checkPolicyDraft: superadminProcedure
    .input(z.object(policyDraftFields))
    .mutation(async ({ ctx, input }) => {
      const org = await resolveCompany(input.uuid);
      const db = getDb();
      const profiles = await db
        .select()
        .from(vendorRequirementProfile)
        .where(eq(vendorRequirementProfile.organizationId, org.id))
        .orderBy(asc(vendorRequirementProfile.id));
      // SPEC §23.3: the per-key strictest merge across ALL profiles — which
      // profile row Postgres returned first must never decide the gate.
      const thresholds = strictestThresholds(profiles);
      const decision = await evaluateAdmission({
        policy: {
          refereeableCategories: input.refereeableCategories,
          assistantPrivilege: input.assistantPrivilege,
          documents: input.documents,
        },
        profiles: profiles.map((p) => ({
          required: p.required,
          mandatory: p.mandatory,
        })),
        thresholds,
        company: { officerCount: await officerCountFor(org.id) },
      });
      await recordPolicyDecision(db, {
        organizationId: org.id,
        action: "CHECK",
        actorUserId: ctx.user.id,
        admissible: decision.admissible,
        violations: decision.violations,
        warnings: decision.warnings,
        thresholds,
      });
      return decision;
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
        .where(eq(vendorRequirementProfile.organizationId, org.id))
        .orderBy(asc(vendorRequirementProfile.id));
      const thresholds = strictestThresholds(profiles);

      const decision = await evaluateAdmission({
        policy: {
          refereeableCategories: (draft.refereeableCategories ?? []) as string[],
          assistantPrivilege: draft.assistantPrivilege,
          documents,
        },
        profiles: profiles.map((p) => ({
          required: p.required,
          mandatory: p.mandatory,
        })),
        thresholds,
        company: { officerCount: await officerCountFor(org.id) },
      });
      if (!decision.admissible) {
        await recordPolicyDecision(db, {
          organizationId: org.id,
          action: "ACTIVATE_REFUSED",
          actorUserId: ctx.user.id,
          companyPolicyId: draft.id,
          policyVersion: draft.version,
          admissible: false,
          violations: decision.violations,
          warnings: decision.warnings,
          thresholds,
        });
        // The gate's reasons ARE the error — typed, never JSON-in-a-message
        // (SPEC §23.9). The errorFormatter surfaces them as data.admission.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La política no es admisible.",
          cause: new AdmissionRefusedError(decision.violations, decision.warnings),
        });
      }

      // For §24.7: does this activation change the assistant tier?
      const [previousActive] = await db
        .select({ assistantPrivilege: companyPolicy.assistantPrivilege })
        .from(companyPolicy)
        .where(
          and(
            eq(companyPolicy.organizationId, org.id),
            eq(companyPolicy.status, "ACTIVE"),
          ),
        )
        .limit(1);

      const { repinned } = await db.transaction(async (tx) =>
        activateCompanyPolicyTx(tx, {
          organizationId: org.id,
          draftId: draft.id,
          draftVersion: draft.version,
          userId: ctx.user.id,
          applyToExistingVendors: input.applyToExistingVendors,
          warnings: decision.warnings,
          thresholds,
        }),
      );

      // SPEC §24.7 — instructions are frozen on parked sessions; a tier change
      // (or a re-pin, which moves vendors across versions) forces fresh ones.
      // Best-effort post-txn: tool gating never depends on this.
      const tierChanged =
        (previousActive?.assistantPrivilege ?? "CONVERSATIONAL") !==
        draft.assistantPrivilege;
      if (tierChanged || repinned > 0) {
        await clearAssistantSessionStatesForOrg(org.id).catch((err) =>
          vendraError("assistant.session_clear_failed", {
            org: org.id,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
      }

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
    .mutation(async ({ ctx, input }) => {
      const org = await resolveCompany(input.uuid);
      // Documents cascade on the FK, so deleting the draft row is enough.
      return getDb().transaction(async (tx) => {
        const deleted = await tx
          .delete(companyPolicy)
          .where(
            and(
              eq(companyPolicy.organizationId, org.id),
              eq(companyPolicy.status, "DRAFT"),
            ),
          )
          .returning({ id: companyPolicy.id, version: companyPolicy.version });
        if (deleted.length > 0) {
          await recordPolicyDecision(tx, {
            organizationId: org.id,
            action: "DRAFT_DISCARD",
            actorUserId: ctx.user.id,
            policyVersion: deleted[0]?.version ?? null,
          });
        }
        return { discarded: deleted.length };
      });
    }),

  /**
   * Re-run the gate over every ACTIVE policy (SPEC §23.6). The gate runs once at
   * activation; an engine upgrade can strand an activated policy referencing
   * entities that left the catalog, and nothing else re-checks it. Verdicts are
   * recorded as RECHECK decisions and returned for the roster to render.
   */
  recheckActivePolicies: superadminProcedure.mutation(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select({ org: organization, policy: companyPolicy })
      .from(companyPolicy)
      .innerJoin(organization, eq(companyPolicy.organizationId, organization.id))
      .where(
        and(eq(companyPolicy.status, "ACTIVE"), ne(organization.slug, PLATFORM_ORG_SLUG)),
      )
      .orderBy(asc(organization.name));

    const results = [];
    for (const { org, policy } of rows) {
      const documents = await loadPolicyWithDocuments(policy.id);
      const profiles = await db
        .select()
        .from(vendorRequirementProfile)
        .where(eq(vendorRequirementProfile.organizationId, org.id))
        .orderBy(asc(vendorRequirementProfile.id));
      const thresholds = strictestThresholds(profiles);
      const decision = await evaluateAdmission({
        policy: {
          refereeableCategories: (policy.refereeableCategories ?? []) as string[],
          documents,
        },
        profiles: profiles.map((p) => ({
          required: p.required,
          mandatory: p.mandatory,
        })),
        thresholds,
      });
      await recordPolicyDecision(db, {
        organizationId: org.id,
        action: "RECHECK",
        actorUserId: ctx.user.id,
        companyPolicyId: policy.id,
        policyVersion: policy.version,
        admissible: decision.admissible,
        violations: decision.violations,
        warnings: decision.warnings,
        thresholds,
      });
      results.push({
        uuid: org.uuid,
        name: org.name,
        version: policy.version,
        admissible: decision.admissible,
        violations: decision.violations,
        warnings: decision.warnings,
      });
    }
    vendraLog("platform.policies_rechecked", {
      by: ctx.user.id,
      checked: results.length,
      inadmissible: results.filter((r) => !r.admissible).length,
    });
    return results;
  }),

  /**
   * The directive-proposal queue (SPEC §24) — per company when `uuid` is
   * given, else across every company (the roster badge's detail view).
   */
  listDirectiveProposals: superadminProcedure
    .input(z.object({ uuid: z.string().uuid().optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const orgIds = input.uuid ? [(await resolveCompany(input.uuid)).id] : null;
      const orgs = orgIds
        ? await db.select().from(organization).where(eq(organization.id, orgIds[0]!))
        : await db
            .select()
            .from(organization)
            .where(ne(organization.slug, PLATFORM_ORG_SLUG));
      const out = [];
      for (const org of orgs) {
        const rows = await listProposalsForOrg(org.id);
        if (rows.length === 0) continue;
        const vendorIds = [
          ...new Set(rows.map((r) => r.vendorId).filter((v): v is number => v !== null)),
        ];
        const vendors = vendorIds.length
          ? await db
              .select({ id: vendor.id, legalName: vendor.legalName })
              .from(vendor)
              .where(inArray(vendor.id, vendorIds))
          : [];
        const vendorName = new Map(vendors.map((v) => [v.id, v.legalName]));
        const versions = await db
          .select({ id: companyPolicy.id, version: companyPolicy.version })
          .from(companyPolicy)
          .where(eq(companyPolicy.organizationId, org.id));
        const versionOf = new Map(versions.map((p) => [p.id, p.version]));
        for (const row of rows) {
          const verdict = row.gateVerdict as {
            admissible?: boolean;
            violations?: { rule: string; detail: string }[];
            warnings?: { rule: string; detail: string }[];
          } | null;
          out.push({
            uuid: row.uuid,
            companyUuid: org.uuid,
            companyName: org.name,
            vendorName: row.vendorId !== null ? (vendorName.get(row.vendorId) ?? null) : null,
            baseVersion: versionOf.get(row.basePolicyId) ?? null,
            appliedVersion:
              row.appliedPolicyId !== null
                ? (versionOf.get(row.appliedPolicyId) ?? null)
                : null,
            rationale: row.rationale,
            summaryLines: summarizeDirectiveDiffLines(row.diff as DirectiveDiff),
            proposedPrivilege: (row.proposedPolicy as ProposedPolicySnapshot)
              .assistantPrivilege as AssistantPrivilege,
            admissible: verdict?.admissible ?? null,
            violations: verdict?.violations ?? [],
            warnings: verdict?.warnings ?? [],
            raisedAt: row.raisedAt.toISOString(),
            resolvedAt: row.resolvedAt?.toISOString() ?? null,
            resolution: row.resolution as
              | "APPROVED"
              | "REJECTED"
              | "SUPERSEDED"
              | null,
            resolutionNote: row.resolutionNote,
          });
        }
      }
      return out;
    }),

  /**
   * Approve a proposal (SPEC §24.3/§24.4): re-gate against the CURRENT world,
   * then draft rows → activation — the same transaction shape as
   * activatePolicy, with the proposer preserved and the approver recorded.
   */
  approveDirectiveProposal: superadminProcedure
    .input(
      z.object({
        uuid: z.string().uuid(),
        note: z.string().max(500).optional(),
        applyToExistingVendors: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [proposal] = await db
        .select()
        .from(directiveProposal)
        .where(
          and(
            eq(directiveProposal.uuid, input.uuid),
            isNull(directiveProposal.resolvedAt),
          ),
        )
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND" });
      const [org] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, proposal.organizationId))
        .limit(1);
      if (!org) throw new TRPCError({ code: "NOT_FOUND" });

      // One-draft-per-org is load-bearing: a pending human draft must be
      // activated or discarded first, never silently displaced (§24.4).
      const [humanDraft] = await db
        .select({ id: companyPolicy.id })
        .from(companyPolicy)
        .where(
          and(
            eq(companyPolicy.organizationId, org.id),
            eq(companyPolicy.status, "DRAFT"),
          ),
        )
        .limit(1);
      if (humanDraft) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Hay un borrador manual pendiente — actívelo o descártelo primero.",
        });
      }

      // Base drift ⇒ SUPERSEDED, never re-based (§24.4).
      const [active] = await db
        .select()
        .from(companyPolicy)
        .where(
          and(
            eq(companyPolicy.organizationId, org.id),
            eq(companyPolicy.status, "ACTIVE"),
          ),
        )
        .limit(1);
      if (!active || active.id !== proposal.basePolicyId) {
        await db.transaction(async (tx) => {
          await resolveProposalTx(tx, {
            proposalId: proposal.id,
            resolution: "SUPERSEDED",
            resolvedByUserId: ctx.user.id,
            resolutionNote:
              "La política activa cambió desde la propuesta; pida al proveedor volver a proponer.",
          });
        });
        vendraLog("platform.directive_superseded", {
          by: ctx.user.id,
          org: org.id,
          proposal: proposal.uuid,
        });
        return { superseded: true as const };
      }

      // The AUTHORITATIVE gate: current engines, profiles, thresholds and
      // officer count — never the stored dry-run (§24.4).
      const snapshot = proposal.proposedPolicy as ProposedPolicySnapshot;
      const profiles = await db
        .select()
        .from(vendorRequirementProfile)
        .where(eq(vendorRequirementProfile.organizationId, org.id))
        .orderBy(asc(vendorRequirementProfile.id));
      const thresholds = strictestThresholds(profiles);
      const decision = await evaluateAdmission({
        policy: {
          refereeableCategories: snapshot.refereeableCategories,
          assistantPrivilege: snapshot.assistantPrivilege,
          documents: snapshot.documents.map((doc) => ({
            documentType: doc.documentType as VendorDocumentType,
            extractFields: doc.extractFields,
            validators: doc.validators as VendorValidatorId[],
          })),
        },
        profiles: profiles.map((p) => ({
          required: p.required,
          mandatory: p.mandatory,
        })),
        thresholds,
        company: { officerCount: await officerCountFor(org.id) },
      });
      if (!decision.admissible) {
        await recordPolicyDecision(db, {
          organizationId: org.id,
          action: "PROPOSAL_APPROVE",
          actorUserId: ctx.user.id,
          admissible: false,
          violations: decision.violations,
          warnings: decision.warnings,
          thresholds,
          metadata: { proposalUuid: proposal.uuid },
        });
        // The proposal stays OPEN: the operator sees why and decides.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La propuesta ya no es admisible.",
          cause: new AdmissionRefusedError(decision.violations, decision.warnings),
        });
      }

      const result = await db.transaction(async (tx) => {
        // Lock the ACTIVE row so a concurrent activation serializes behind us.
        await tx
          .select({ id: companyPolicy.id })
          .from(companyPolicy)
          .where(eq(companyPolicy.id, active.id))
          .for("update");
        const [{ maxVersion }] = await tx
          .select({
            maxVersion: sql<number>`coalesce(max(${companyPolicy.version}), 0)`,
          })
          .from(companyPolicy)
          .where(eq(companyPolicy.organizationId, org.id));
        const version = Number(maxVersion) + 1;
        const [created] = await tx
          .insert(companyPolicy)
          .values({
            organizationId: org.id,
            version,
            status: "DRAFT",
            refereeableCategories: snapshot.refereeableCategories,
            assistantPrivilege: snapshot.assistantPrivilege,
            // The approving superadmin authors the version; the proposer stays
            // auditable on the proposal row (§24.3).
            createdByUserId: ctx.user.id,
          })
          .returning({ id: companyPolicy.id });
        if (!created) throw new Error("proposal draft insert returned no row");
        if (snapshot.documents.length > 0) {
          await tx.insert(companyPolicyDocument).values(
            snapshot.documents.map((doc) => ({
              companyPolicyId: created.id,
              documentType: doc.documentType,
              extractFields: doc.extractFields,
              validators: doc.validators,
            })),
          );
        }
        const { repinned } = await activateCompanyPolicyTx(tx, {
          organizationId: org.id,
          draftId: created.id,
          draftVersion: version,
          userId: ctx.user.id,
          applyToExistingVendors: input.applyToExistingVendors,
          warnings: decision.warnings,
          thresholds,
          metadata: { proposalUuid: proposal.uuid },
        });
        await resolveProposalTx(tx, {
          proposalId: proposal.id,
          resolution: "APPROVED",
          resolvedByUserId: ctx.user.id,
          resolutionNote: input.note ?? null,
          appliedPolicyId: created.id,
        });
        const superseded = await supersedeOpenProposalsForOrgTx(
          tx,
          org.id,
          proposal.id,
        );
        await recordPolicyDecision(tx, {
          organizationId: org.id,
          action: "PROPOSAL_APPROVE",
          actorUserId: ctx.user.id,
          companyPolicyId: created.id,
          policyVersion: version,
          admissible: true,
          warnings: decision.warnings,
          thresholds,
          metadata: { proposalUuid: proposal.uuid, repinnedVendors: repinned },
        });
        return { version, repinned, superseded };
      });

      // §24.7 — the tier may have changed, and a re-pin moves vendors: force
      // fresh sessions. Best-effort; gating never depends on it.
      const tierChanged =
        active.assistantPrivilege !== snapshot.assistantPrivilege;
      if (tierChanged || result.repinned > 0) {
        await clearAssistantSessionStatesForOrg(org.id).catch((err) =>
          vendraError("assistant.session_clear_failed", {
            org: org.id,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      // §24.6 — consolidate the approval into org-scoped memory. Best-effort.
      const [vendorRow] = proposal.vendorId
        ? await db
            .select({ legalName: vendor.legalName })
            .from(vendor)
            .where(eq(vendor.id, proposal.vendorId))
            .limit(1)
        : [];
      await consolidateDirectiveOutcome({
        organization: { id: org.id, uuid: org.uuid },
        diff: proposal.diff as DirectiveDiff,
        vendorName: vendorRow?.legalName ?? null,
        approved: true,
        appliedVersion: result.version,
        resolutionNote: input.note ?? null,
        dateIso: new Date().toISOString().slice(0, 10),
      });

      vendraLog("platform.directive_approved", {
        by: ctx.user.id,
        org: org.id,
        proposal: proposal.uuid,
        version: result.version,
        repinnedVendors: result.repinned,
        supersededProposals: result.superseded,
        noteLen: input.note?.length ?? 0,
      });
      return {
        superseded: false as const,
        version: result.version,
        repinnedVendors: result.repinned,
        warnings: decision.warnings,
      };
    }),

  rejectDirectiveProposal: superadminProcedure
    .input(z.object({ uuid: z.string().uuid(), note: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [proposal] = await db
        .select()
        .from(directiveProposal)
        .where(
          and(
            eq(directiveProposal.uuid, input.uuid),
            isNull(directiveProposal.resolvedAt),
          ),
        )
        .limit(1);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND" });
      const [org] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, proposal.organizationId))
        .limit(1);
      if (!org) throw new TRPCError({ code: "NOT_FOUND" });

      await db.transaction(async (tx) => {
        await resolveProposalTx(tx, {
          proposalId: proposal.id,
          resolution: "REJECTED",
          resolvedByUserId: ctx.user.id,
          resolutionNote: input.note,
        });
        await recordPolicyDecision(tx, {
          organizationId: org.id,
          action: "PROPOSAL_REJECT",
          actorUserId: ctx.user.id,
          metadata: { proposalUuid: proposal.uuid, noteLen: input.note.length },
        });
      });

      // §24.6 — a remembered rejection stops the assistant re-proposing it.
      const [vendorRow] = proposal.vendorId
        ? await db
            .select({ legalName: vendor.legalName })
            .from(vendor)
            .where(eq(vendor.id, proposal.vendorId))
            .limit(1)
        : [];
      await consolidateDirectiveOutcome({
        organization: { id: org.id, uuid: org.uuid },
        diff: proposal.diff as DirectiveDiff,
        vendorName: vendorRow?.legalName ?? null,
        approved: false,
        appliedVersion: null,
        resolutionNote: input.note,
        dateIso: new Date().toISOString().slice(0, 10),
      });

      vendraLog("platform.directive_rejected", {
        by: ctx.user.id,
        org: org.id,
        proposal: proposal.uuid,
        noteLen: input.note.length,
      });
      return { rejected: true as const };
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
