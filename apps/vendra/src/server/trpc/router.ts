/**
 * The officer rescue toolkit (SPEC §8.3) — six mutations, every one on
 * the W1.3 atomicity contract: (a) row-lock the target, (b) apply the
 * mutation, (c) write its activity row in the SAME transaction, (d) funnel
 * through the recompute ON that transaction (read-your-writes), (e) log
 * latency spans. Mutation logs carry `noteLen` only — justification bodies
 * are officer-authored free text and are never emitted.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@vendra/db-vendor";
import {
  REQUIREMENT_CATEGORY_VALUES,
  VENDOR_DOCUMENT_TYPE_VALUES,
  VendorDocumentTypeEnum,
  deriveAllowedDocumentTypes,
  applyValidatorPolicy,
  effectiveAllowedDocumentTypes,
  resolveDocumentPolicy,
  deriveExtractedExpirationDate,
  failedValidationMessages,
  getPotentialRequirementsForDocumentType,
  isCoverageDeterminationCategory,
  scopeWaiverCascadeCategories,
  validateVendorDocument,
  vendraLog,
  verifyRequirements,
  type ValidationRule,
  type VendorDocumentType,
} from "@vendra/workflow/vendor";

import { buildComplianceSummary } from "@/server/compliance-summary";
import { runCoverageDetermination } from "@/server/harness/coverage-runner";
import { loadDocumentsSnapshot } from "@/server/harness/db/page-load";
import {
  hasOpenReferral,
  resolveOpenReferralAsGranted,
} from "@/server/harness/db/referrals";
import { loadVendorCompanyPolicy } from "@/server/company-policy";
import { toRequirementProfile, toThresholds, toWorkProfile } from "@/server/profile";
import { recomputeCrossDocumentRequirementsForVendor } from "@/server/recompute";
import { generateDownloadUrl } from "@/server/storage";

import { complianceAdminProcedure, router } from "./init";
import { platformRouter } from "./platform-router";

const {
  manualRequirementGrant,
  organization,
  vendor,
  vendorActivity,
  vendorDocument,
  vendorDocumentExtraction,
  vendorRequirementProfile,
  vendorStatusTransition,
  vendorTag,
  vendorTagAssignment,
} = schema;

type Tx = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

/** Row-lock a vendor by uuid inside the caller's org. */
async function lockVendorByUuid(tx: Tx, vendorUuid: string, orgId: number) {
  const [row] = await tx
    .select()
    .from(vendor)
    .where(and(eq(vendor.uuid, vendorUuid), eq(vendor.organizationId, orgId)))
    .for("update")
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return row;
}

/** Row-lock a document (+ its vendor) by uuid inside the caller's org. */
async function lockDocumentByUuid(tx: Tx, documentUuid: string, orgId: number) {
  const [doc] = await tx
    .select()
    .from(vendorDocument)
    .where(
      and(
        eq(vendorDocument.uuid, documentUuid),
        eq(vendorDocument.organizationId, orgId),
      ),
    )
    .for("update")
    .limit(1);
  if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
  const [vendorRow] = await tx
    .select()
    .from(vendor)
    .where(eq(vendor.id, doc.vendorId))
    .for("update")
    .limit(1);
  if (!vendorRow) throw new TRPCError({ code: "NOT_FOUND" });
  return { doc, vendorRow };
}

async function latestExtractionOnTx(tx: Tx, documentId: number) {
  const [row] = await tx
    .select()
    .from(vendorDocumentExtraction)
    .where(eq(vendorDocumentExtraction.documentId, documentId))
    .orderBy(desc(vendorDocumentExtraction.version))
    .limit(1);
  return row ?? null;
}

/** Append an entry to a metadata audit array via a single jsonb merge. */
function appendMetadataAudit(
  tx: Tx,
  vendorId: number,
  key: string,
  entry: Record<string, unknown>,
) {
  return tx
    .update(vendor)
    .set({
      complianceStatusMetadata: sql`jsonb_set(COALESCE(${vendor.complianceStatusMetadata}, '{}'::jsonb), ARRAY[${key}::text], COALESCE(${vendor.complianceStatusMetadata} -> ${key}::text, '[]'::jsonb) || ${JSON.stringify(entry)}::jsonb)`,
      updatedAt: sql`now()`,
    })
    .where(eq(vendor.id, vendorId));
}

function insertActivityOnTx(
  tx: Tx,
  input: {
    vendorId: number;
    organizationId: number;
    type: (typeof vendorActivity.$inferSelect)["type"];
    actorUserId: string;
    documentId?: number;
    metadata?: unknown;
  },
) {
  return tx.insert(vendorActivity).values({
    vendorId: input.vendorId,
    organizationId: input.organizationId,
    type: input.type,
    actorUserId: input.actorUserId,
    documentId: input.documentId ?? null,
    metadata: input.metadata,
  });
}

export const appRouter = router({
  /** The superadmin surface (SPEC §19.5) — cross-tenant, its own guard. */
  platform: platformRouter,

  // ═══════════════════════════════════════════════ queries ═══════

  listVendors: complianceAdminProcedure
    .input(
      z
        .object({
          search: z.string().max(200).optional(),
          // Enum-validated: an arbitrary string would reach Postgres as an
          // invalid enum literal and surface as a 500.
          status: z.enum(schema.complianceStatusEnum.enumValues).optional(),
          expiringWithinDays: z.number().int().positive().max(365).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const conditions = [eq(vendor.organizationId, ctx.organizationId)];
      if (input?.search) {
        const needle = `%${input.search}%`;
        conditions.push(
          or(ilike(vendor.legalName, needle), ilike(vendor.dbaName, needle))!,
        );
      }
      if (input?.status) {
        conditions.push(eq(vendor.complianceStatus, input.status));
      }
      if (input?.expiringWithinDays) {
        const horizon = new Date(
          Date.now() + input.expiringWithinDays * 24 * 60 * 60 * 1000,
        )
          .toISOString()
          .slice(0, 10);
        conditions.push(
          and(isNotNull(vendor.nextExpiryAt), lte(vendor.nextExpiryAt, horizon))!,
        );
      }
      const rows = await db
        .select()
        .from(vendor)
        .where(and(...conditions))
        .orderBy(sql`${vendor.nextExpiryAt} ASC NULLS LAST`, desc(vendor.updatedAt));

      const vendorIds = rows.map((r) => r.id);
      const tagRows =
        vendorIds.length > 0
          ? await db
              .select({
                vendorId: vendorTagAssignment.vendorId,
                name: vendorTag.name,
              })
              .from(vendorTagAssignment)
              .innerJoin(vendorTag, eq(vendorTagAssignment.tagId, vendorTag.id))
              .where(inArray(vendorTagAssignment.vendorId, vendorIds))
          : [];
      const tagsByVendor = new Map<number, string[]>();
      for (const t of tagRows) {
        const list = tagsByVendor.get(t.vendorId) ?? [];
        list.push(t.name);
        tagsByVendor.set(t.vendorId, list);
      }

      return rows.map((row) => {
        const meta = (row.complianceStatusMetadata ?? {}) as Record<string, unknown>;
        const fold = (meta.cross_document_requirements ?? {}) as Record<string, unknown>;
        const granted = Array.isArray(fold.granted) ? (fold.granted as string[]) : [];
        const coverage = (fold.coverage ?? {}) as Record<string, unknown>;
        return {
          uuid: row.uuid,
          legalName: row.legalName,
          dbaName: row.dbaName,
          complianceStatus: row.complianceStatus,
          nextExpiryAt: row.nextExpiryAt,
          grantedCount: granted.length,
          coverageDetermining: coverage.determining === true,
          tags: tagsByVendor.get(row.id) ?? [],
          registeredAt: row.registeredAt,
          updatedAt: row.updatedAt,
        };
      });
    }),

  getVendor: complianceAdminProcedure
    .input(z.object({ vendorUuid: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db
        .select({ vendor, profile: vendorRequirementProfile, organization })
        .from(vendor)
        .innerJoin(
          vendorRequirementProfile,
          eq(vendor.requirementProfileId, vendorRequirementProfile.id),
        )
        .innerJoin(organization, eq(vendor.organizationId, organization.id))
        .where(
          and(
            eq(vendor.uuid, input.vendorUuid),
            eq(vendor.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const activity = await db
        .select()
        .from(vendorActivity)
        .where(eq(vendorActivity.vendorId, row.vendor.id))
        .orderBy(desc(vendorActivity.createdAt))
        .limit(50);
      const transitions = await db
        .select()
        .from(vendorStatusTransition)
        .where(eq(vendorStatusTransition.vendorId, row.vendor.id))
        .orderBy(desc(vendorStatusTransition.createdAt))
        .limit(20);
      const meta = (row.vendor.complianceStatusMetadata ?? {}) as Record<string, unknown>;
      return {
        vendor: {
          uuid: row.vendor.uuid,
          legalName: row.vendor.legalName,
          dbaName: row.vendor.dbaName,
          tinLast4: row.vendor.tinLast4,
          entityType: row.vendor.entityType,
          naicsCode: row.vendor.naicsCode,
          contactEmail: row.vendor.contactEmail,
          workProfile: toWorkProfile(row.vendor.workProfile),
          complianceStatus: row.vendor.complianceStatus,
          signoffAt: row.vendor.signoffAt,
          nextExpiryAt: row.vendor.nextExpiryAt,
          registeredAt: row.vendor.registeredAt,
        },
        profileName: row.profile.name,
        activity,
        transitions,
        auditArrays: {
          classificationOverrides: (meta.classification_overrides ?? []) as unknown[],
          manualRequirementOverrides: (meta.manual_requirement_overrides ?? []) as unknown[],
          retryEvents: (meta.retry_events ?? []) as unknown[],
        },
      };
    }),

  requirementTraceability: complianceAdminProcedure
    .input(z.object({ vendorUuid: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db
        .select({ id: vendor.id })
        .from(vendor)
        .where(
          and(
            eq(vendor.uuid, input.vendorUuid),
            eq(vendor.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const [summary, documents] = await Promise.all([
        buildComplianceSummary(row.id),
        loadDocumentsSnapshot(row.id),
      ]);
      return { summary, documents };
    }),

  listAllDocuments: complianceAdminProcedure
    .input(z.object({ vendorUuid: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db
        .select({ id: vendor.id })
        .from(vendor)
        .where(
          and(
            eq(vendor.uuid, input.vendorUuid),
            eq(vendor.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return loadDocumentsSnapshot(row.id);
    }),

  documentDownloadUrl: complianceAdminProcedure
    .input(z.object({ documentUuid: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [doc] = await db
        .select({
          fileKey: vendorDocument.fileKey,
          fileMetadata: vendorDocument.fileMetadata,
        })
        .from(vendorDocument)
        .where(
          and(
            eq(vendorDocument.uuid, input.documentUuid),
            eq(vendorDocument.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      const meta = (doc.fileMetadata ?? {}) as Record<string, unknown>;
      const fileName =
        typeof meta.fileName === "string" ? meta.fileName : "document";
      const mimeType = typeof meta.type === "string" ? meta.type : undefined;
      // Two signatures off one key (SPEC §8.2): inline for the viewer pane,
      // attachment for the named download. Same 900s expiry, same object.
      const [previewUrl, downloadUrl] = await Promise.all([
        generateDownloadUrl(doc.fileKey, {
          disposition: "inline",
          ...(mimeType ? { mimeType } : {}),
        }),
        generateDownloadUrl(doc.fileKey, {
          disposition: "attachment",
          fileName,
          ...(mimeType ? { mimeType } : {}),
        }),
      ]);
      return { previewUrl, downloadUrl, fileName, mimeType: mimeType ?? null };
    }),

  // ═══════════════════════════════════════════ mutations ═══════

  waiveDocumentValidation: complianceAdminProcedure
    .input(
      z.object({
        vendorDocumentUuid: z.string().uuid(),
        waive: z.boolean(),
        scopedCategories: z.array(z.enum(REQUIREMENT_CATEGORY_VALUES)).max(11),
        justification: z.string().trim().min(10).max(1000),
        waiverExpiresAt: z.coerce.date().optional(),
        /** Optimistic-concurrency pin — mismatch throws CONFLICT. */
        expectedCurrentWaiver: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const txStartedAt = Date.now();
      const result = await getDb().transaction(async (tx) => {
        const lockStartedAt = Date.now();
        const { doc, vendorRow } = await lockDocumentByUuid(
          tx,
          input.vendorDocumentUuid,
          ctx.organizationId,
        );
        const rowLockMs = Date.now() - lockStartedAt;
        const extraction = await latestExtractionOnTx(tx, doc.id);
        if (!extraction) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El documento no tiene una extracción sobre la cual aplicar una exención.",
          });
        }
        const currentWaiver = (extraction.waiver ?? {}) as Record<string, unknown>;
        const currentActive = currentWaiver.active === true;
        if (
          input.expectedCurrentWaiver !== undefined &&
          input.expectedCurrentWaiver !== currentActive
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "El estado de la exención cambió mientras trabajaba — recargue e intente de nuevo.",
          });
        }

        let scoped: string[] = [];
        if (input.waive) {
          if (!input.waiverExpiresAt) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Una exención requiere una fecha de vencimiento.",
            });
          }
          if (input.scopedCategories.length === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Una exención requiere al menos una categoría en su alcance.",
            });
          }
          // B-1 cascade — server-enforced, never UI-trusted: narrow to what
          // this failure legitimately blocks, intersect officer intent.
          scoped = scopeWaiverCascadeCategories(
            getPotentialRequirementsForDocumentType(
              extraction.documentType as VendorDocumentType,
            ),
            (extraction.validationRules ?? []) as ValidationRule[],
            input.scopedCategories,
          );
          if (scoped.length === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Ninguna de las categorías solicitadas puede eximirse a partir de la falla de este documento.",
            });
          }
        }

        const waiverValue = input.waive
          ? {
              active: true,
              note: input.justification,
              scopedCategories: scoped,
              expiresAt: input.waiverExpiresAt!.toISOString().slice(0, 10),
              actorUserId: ctx.user.id,
              at: new Date().toISOString(),
            }
          : {
              active: false,
              actorUserId: ctx.user.id,
              at: new Date().toISOString(),
            };
        await tx
          .update(vendorDocumentExtraction)
          .set({ waiver: waiverValue })
          .where(eq(vendorDocumentExtraction.id, extraction.id));

        await insertActivityOnTx(tx, {
          vendorId: vendorRow.id,
          organizationId: ctx.organizationId,
          type: "DOCUMENT_WAIVED",
          actorUserId: ctx.user.id,
          documentId: doc.id,
          metadata: {
            documentUuid: doc.uuid,
            waive: input.waive,
            scopedCategories: scoped,
            noteLen: input.justification.length,
          },
        });

        const recompute = await recomputeCrossDocumentRequirementsForVendor(
          vendorRow.id,
          tx,
        );
        return { vendorId: vendorRow.id, scoped, recompute, rowLockMs };
      });

      vendraLog("officer.waive", {
        doc: input.vendorDocumentUuid,
        vendor: result.vendorId,
        waive: input.waive,
        scoped: result.scoped.join(","),
        noteLen: input.justification.length,
        rowLockMs: result.rowLockMs,
        txnMs: Date.now() - txStartedAt,
      });
      runCoverageDetermination(result.vendorId);
      return { waived: input.waive, scopedCategories: result.scoped };
    }),

  reclassifyDocument: complianceAdminProcedure
    .input(
      z.object({
        vendorDocumentUuid: z.string().uuid(),
        newDocumentType: z.enum(VENDOR_DOCUMENT_TYPE_VALUES),
        justification: z.string().trim().min(10).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.newDocumentType === VendorDocumentTypeEnum.UNKNOWN) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "UNKNOWN no es un tipo de documento válido para la recategorización.",
        });
      }
      const txStartedAt = Date.now();
      const result = await getDb().transaction(async (tx) => {
        const { doc, vendorRow } = await lockDocumentByUuid(
          tx,
          input.vendorDocumentUuid,
          ctx.organizationId,
        );
        const [profileRow] = await tx
          .select()
          .from(vendorRequirementProfile)
          .where(eq(vendorRequirementProfile.id, vendorRow.requirementProfileId))
          .limit(1);
        if (!profileRow) throw new TRPCError({ code: "NOT_FOUND" });
        const profile = toRequirementProfile(profileRow);
        // SPEC §19.1: the company policy bounds the profile-derived set, exactly
        // as the document lane does — an officer must not be able to reclassify
        // into a type the company does not accept.
        const policy = await loadVendorCompanyPolicy(vendorRow);
        const profileDerived = deriveAllowedDocumentTypes(profile.required);
        const allowed = policy
          ? effectiveAllowedDocumentTypes(policy, profileDerived)
          : profileDerived;
        if (!allowed.has(input.newDocumentType)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Este perfil no acepta ese tipo de documento.",
          });
        }
        const extraction = await latestExtractionOnTx(tx, doc.id);
        if (!extraction) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El documento no tiene una extracción que trasladar.",
          });
        }
        const fromType = extraction.documentType;
        const extractedData = (extraction.extractedData ?? {}) as Record<string, unknown>;

        // Re-run validation + requirement verification on the carried-forward
        // extraction under the new type.
        const workProfile = toWorkProfile(vendorRow.workProfile);
        const rawValidation = validateVendorDocument(
          input.newDocumentType,
          extractedData,
          {
            legalName: vendorRow.legalName,
            dbaName: vendorRow.dbaName,
            workStates: workProfile.states ?? [],
          },
          { thresholds: toThresholds(profileRow) },
        );
        // §19.1: persist the COMPANY's verdict, not the superset's. Without this
        // a reclassify is stricter than the pipeline that produced the document.
        const docPolicy = policy
          ? resolveDocumentPolicy(policy, input.newDocumentType)
          : null;
        const validation = docPolicy
          ? applyValidatorPolicy(rawValidation, docPolicy.validators)
          : rawValidation;
        const requirements = verifyRequirements(
          input.newDocumentType,
          extractedData,
          validation,
        );

        // Insert extraction version+1 with waiver state RESET.
        const newVersion = extraction.version + 1;
        await tx.insert(vendorDocumentExtraction).values({
          documentId: doc.id,
          version: newVersion,
          documentType: input.newDocumentType,
          documentSubtype: null,
          classificationConfidence: null,
          classificationReasoning: `Reclassified by a compliance officer (was ${fromType}).`,
          extractedData,
          fieldConfidences: extraction.fieldConfidences,
          validationRules: validation?.rules ?? [],
          validationValid: validation?.valid ?? false,
          requirementsGranted: requirements.satisfiedCategories,
          scopedCategories: [],
          waiver: null,
          model: extraction.model,
          source: "officer_reclassify",
        });

        // Status follows the re-validation verdict. A fail→success
        // reclassify must also DROP the stale failureReason (SPEC §17 C3:
        // a failure note must never sit beside a Verified pill).
        if (validation?.valid) {
          await tx
            .update(vendorDocument)
            .set({
              uploadStatus: "PROCESSED",
              uploadType: input.newDocumentType,
              extractedExpirationDate: deriveExtractedExpirationDate(
                input.newDocumentType,
                extractedData,
              ),
              fileMetadata: sql`COALESCE(${vendorDocument.fileMetadata}, '{}'::jsonb) - 'failureReason'`,
              updatedAt: sql`now()`,
            })
            .where(eq(vendorDocument.id, doc.id));
        } else {
          const failedMessages = failedValidationMessages(validation?.rules ?? []);
          await tx
            .update(vendorDocument)
            .set({
              uploadStatus: "FAILED",
              uploadType: null,
              fileMetadata: sql`COALESCE(${vendorDocument.fileMetadata}, '{}'::jsonb) || jsonb_build_object('failureReason', ${failedMessages[0] ?? "La validación del documento falló."}::text)`,
              updatedAt: sql`now()`,
            })
            .where(eq(vendorDocument.id, doc.id));
        }

        await appendMetadataAudit(tx, vendorRow.id, "classification_overrides", {
          action: "RECLASSIFY",
          documentUuid: doc.uuid,
          from: fromType,
          to: input.newDocumentType,
          actorUserId: ctx.user.id,
          at: new Date().toISOString(),
        });
        await insertActivityOnTx(tx, {
          vendorId: vendorRow.id,
          organizationId: ctx.organizationId,
          type: "DOCUMENT_RECLASSIFIED",
          actorUserId: ctx.user.id,
          documentId: doc.id,
          metadata: {
            documentUuid: doc.uuid,
            from: fromType,
            to: input.newDocumentType,
            valid: validation?.valid ?? false,
            noteLen: input.justification.length,
          },
        });

        await recomputeCrossDocumentRequirementsForVendor(vendorRow.id, tx);
        return {
          vendorId: vendorRow.id,
          valid: validation?.valid ?? false,
          requirementsGranted: requirements.satisfiedCategories,
        };
      });

      vendraLog("officer.reclassify", {
        doc: input.vendorDocumentUuid,
        vendor: result.vendorId,
        to: input.newDocumentType,
        valid: result.valid,
        noteLen: input.justification.length,
        txnMs: Date.now() - txStartedAt,
      });
      runCoverageDetermination(result.vendorId);
      return result;
    }),

  grantManualRequirement: complianceAdminProcedure
    .input(
      z.object({
        vendorDocumentUuid: z.string().uuid(),
        category: z.enum(REQUIREMENT_CATEGORY_VALUES),
        justification: z.string().trim().min(10).max(1000),
        acknowledgeOverride: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const txStartedAt = Date.now();
      const result = await getDb().transaction(async (tx) => {
        const { doc, vendorRow } = await lockDocumentByUuid(
          tx,
          input.vendorDocumentUuid,
          ctx.organizationId,
        );

        // A FAILED/ERROR source doc requires the explicit acknowledgement.
        if (
          (doc.uploadStatus === "FAILED" || doc.uploadStatus === "ERROR") &&
          input.acknowledgeOverride !== true
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Este documento no pasó la validación — reconozca la anulación para otorgar el requisito con base en él.",
          });
        }

        // Already-satisfied rejection — EXCEPT where per-doc extraction
        // evidence is not the effective grant, in which case the manual grant
        // is the officer's ONLY remedy and rejecting it as "already satisfied"
        // is a dead end. Two such cases:
        //
        //  - the coverage-determination categories, where the determination is
        //    the authority (§18 D2);
        //  - a category with an OPEN REFERRAL (§19.4). The extraction row
        //    truthfully records what the document evidenced, while the fold
        //    withholds the grant by policy — so this check fired on exactly the
        //    categories the referral exists to have a human decide, making the
        //    referee boundary unresolvable. Found by driving the flow on
        //    browser: the W-9 verified, the referral opened, and "Otorgar
        //    manualmente" answered "this document already satisfies that
        //    category".
        const referred = await hasOpenReferral(vendorRow.id, input.category, tx);
        if (!isCoverageDeterminationCategory(input.category) && !referred) {
          const extraction = await latestExtractionOnTx(tx, doc.id);
          const alreadyProven =
            doc.uploadStatus === "PROCESSED" &&
            (extraction?.requirementsGranted ?? []).includes(input.category);
          if (alreadyProven) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Este documento ya satisface esa categoría.",
            });
          }
        }

        // Duplicate active grants stay safe via already_active idempotency.
        const [existing] = await tx
          .select({ id: manualRequirementGrant.id })
          .from(manualRequirementGrant)
          .where(
            and(
              eq(manualRequirementGrant.documentId, doc.id),
              eq(manualRequirementGrant.category, input.category),
              isNull(manualRequirementGrant.revokedAt),
            ),
          )
          .limit(1);
        if (existing) {
          return { vendorId: vendorRow.id, alreadyActive: true as const };
        }

        await tx.insert(manualRequirementGrant).values({
          documentId: doc.id,
          category: input.category,
          justification: input.justification,
          grantedByUserId: ctx.user.id,
        });
        // SPEC §23.14: granting a category with an open referral IS the
        // ratification — record the verdict and the officer on the referral
        // itself, in this transaction, before the recompute's fold would close
        // it as an anonymous SUPERSEDED.
        if (referred) {
          await resolveOpenReferralAsGranted(tx, {
            vendorId: vendorRow.id,
            organizationId: ctx.organizationId,
            category: input.category,
            resolvedByUserId: ctx.user.id,
          });
        }
        await appendMetadataAudit(tx, vendorRow.id, "manual_requirement_overrides", {
          action: "GRANT",
          documentUuid: doc.uuid,
          category: input.category,
          actorUserId: ctx.user.id,
          at: new Date().toISOString(),
        });
        await insertActivityOnTx(tx, {
          vendorId: vendorRow.id,
          organizationId: ctx.organizationId,
          type: "MANUAL_REQUIREMENT_GRANTED",
          actorUserId: ctx.user.id,
          documentId: doc.id,
          metadata: {
            documentUuid: doc.uuid,
            category: input.category,
            noteLen: input.justification.length,
          },
        });

        await recomputeCrossDocumentRequirementsForVendor(vendorRow.id, tx);
        return { vendorId: vendorRow.id, alreadyActive: false as const };
      });

      vendraLog("officer.grant", {
        doc: input.vendorDocumentUuid,
        vendor: result.vendorId,
        category: input.category,
        alreadyActive: result.alreadyActive,
        noteLen: input.justification.length,
        txnMs: Date.now() - txStartedAt,
      });
      runCoverageDetermination(result.vendorId);
      return result;
    }),

  revokeManualRequirement: complianceAdminProcedure
    .input(
      z.object({
        vendorDocumentUuid: z.string().uuid(),
        category: z.enum(REQUIREMENT_CATEGORY_VALUES),
        justification: z.string().trim().min(10).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const txStartedAt = Date.now();
      const result = await getDb().transaction(async (tx) => {
        const { doc, vendorRow } = await lockDocumentByUuid(
          tx,
          input.vendorDocumentUuid,
          ctx.organizationId,
        );
        const revoked = await tx
          .update(manualRequirementGrant)
          .set({
            revokedAt: sql`now()`,
            revokedByUserId: ctx.user.id,
            revokeJustification: input.justification,
          })
          .where(
            and(
              eq(manualRequirementGrant.documentId, doc.id),
              eq(manualRequirementGrant.category, input.category),
              isNull(manualRequirementGrant.revokedAt),
            ),
          )
          .returning({ id: manualRequirementGrant.id });
        if (revoked.length === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "No hay una concesión activa que revocar — es posible que ya haya sido revocada.",
          });
        }
        await appendMetadataAudit(tx, vendorRow.id, "manual_requirement_overrides", {
          action: "REVOKE",
          documentUuid: doc.uuid,
          category: input.category,
          actorUserId: ctx.user.id,
          at: new Date().toISOString(),
        });
        await insertActivityOnTx(tx, {
          vendorId: vendorRow.id,
          organizationId: ctx.organizationId,
          type: "MANUAL_REQUIREMENT_REVOKED",
          actorUserId: ctx.user.id,
          documentId: doc.id,
          metadata: {
            documentUuid: doc.uuid,
            category: input.category,
            noteLen: input.justification.length,
          },
        });
        await recomputeCrossDocumentRequirementsForVendor(vendorRow.id, tx);
        return { vendorId: vendorRow.id };
      });

      vendraLog("officer.revoke", {
        doc: input.vendorDocumentUuid,
        vendor: result.vendorId,
        category: input.category,
        noteLen: input.justification.length,
        txnMs: Date.now() - txStartedAt,
      });
      runCoverageDetermination(result.vendorId);
      return { revoked: true };
    }),

  retryDocumentProcessing: complianceAdminProcedure
    .input(z.object({ vendorDocumentUuid: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Round-2 hardening B8: the reset now rides the W1.3 contract — CAS
      // reset + audit append + activity row + recompute in ONE transaction,
      // like every other officer mutation. RESET-ONLY semantics unchanged:
      // FAILED|ERROR → UPLOADED; nothing auto-claims the reset doc — the
      // janitor's stale-UPLOADED sweep flips it back if nobody re-enters.
      const doc = await getDb().transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(vendorDocument)
          .where(
            and(
              eq(vendorDocument.uuid, input.vendorDocumentUuid),
              eq(vendorDocument.organizationId, ctx.organizationId),
            ),
          )
          .for("update")
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });

        const reset = await tx
          .update(vendorDocument)
          .set({
            uploadStatus: "UPLOADED",
            // The reset doc is no longer failed — drop the stale
            // failureReason so nothing renders it beside a live pill.
            fileMetadata: sql`COALESCE(${vendorDocument.fileMetadata}, '{}'::jsonb) - 'failureReason'`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(vendorDocument.id, row.id),
              inArray(vendorDocument.uploadStatus, ["FAILED", "ERROR"]),
            ),
          )
          .returning({ id: vendorDocument.id });
        if (reset.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El documento no está en un estado que permita reintentar.",
          });
        }
        await appendMetadataAudit(tx, row.vendorId, "retry_events", {
          documentUuid: row.uuid,
          actorUserId: ctx.user.id,
          at: new Date().toISOString(),
        });
        await tx.insert(vendorActivity).values({
          vendorId: row.vendorId,
          organizationId: ctx.organizationId,
          type: "RETRY_REQUESTED",
          actorUserId: ctx.user.id,
          documentId: row.id,
          metadata: { documentUuid: row.uuid },
        });
        await recomputeCrossDocumentRequirementsForVendor(row.vendorId, tx);
        return row;
      });
      vendraLog("officer.retry_reset", {
        doc: doc.uuid,
        vendor: doc.vendorId,
        org: ctx.organizationId,
      });
      return { reset: true };
    }),

  finalizeStatus: complianceAdminProcedure
    .input(
      z.object({
        vendorUuid: z.string().uuid(),
        status: z.enum(["PRE_APPROVED", "NEED_REVIEW", "APPROVED", "REJECTED"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const txStartedAt = Date.now();
      const result = await getDb().transaction(async (tx) => {
        const vendorRow = await lockVendorByUuid(
          tx,
          input.vendorUuid,
          ctx.organizationId,
        );
        // Idempotent same-status no-op preserving the signoff clock.
        if (vendorRow.complianceStatus === input.status) {
          return { vendorId: vendorRow.id, changed: false as const, from: input.status };
        }
        await tx
          .update(vendor)
          .set({
            complianceStatus: input.status,
            signoffUserId: ctx.user.id,
            signoffAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(vendor.id, vendorRow.id));
        await insertActivityOnTx(tx, {
          vendorId: vendorRow.id,
          organizationId: ctx.organizationId,
          type: "STATUS_CHANGED",
          actorUserId: ctx.user.id,
          metadata: { from: vendorRow.complianceStatus, to: input.status },
        });
        return {
          vendorId: vendorRow.id,
          changed: true as const,
          from: vendorRow.complianceStatus,
        };
      });

      // Fail-open post-commit status-transition row, source officer_decision.
      if (result.changed) {
        await getDb()
          .insert(vendorStatusTransition)
          .values({
            vendorId: result.vendorId,
            fromStatus: result.from,
            toStatus: input.status,
            source: "officer_decision",
            actorUserId: ctx.user.id,
          })
          .catch(() => undefined);
      }
      vendraLog("officer.finalize_status", {
        vendor: result.vendorId,
        to: input.status,
        changed: result.changed,
        txnMs: Date.now() - txStartedAt,
      });
      return { status: input.status, changed: result.changed };
    }),

  setVendorTags: complianceAdminProcedure
    .input(
      z.object({
        vendorUuid: z.string().uuid(),
        tags: z.array(z.string().trim().min(1).max(50)).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await getDb().transaction(async (tx) => {
        const vendorRow = await lockVendorByUuid(
          tx,
          input.vendorUuid,
          ctx.organizationId,
        );
        const tagIds: number[] = [];
        for (const name of input.tags) {
          const [existing] = await tx
            .select({ id: vendorTag.id })
            .from(vendorTag)
            .where(
              and(
                eq(vendorTag.organizationId, ctx.organizationId),
                eq(vendorTag.name, name),
              ),
            )
            .limit(1);
          if (existing) {
            tagIds.push(existing.id);
          } else {
            const [created] = await tx
              .insert(vendorTag)
              .values({ organizationId: ctx.organizationId, name })
              .returning({ id: vendorTag.id });
            if (created) tagIds.push(created.id);
          }
        }
        await tx
          .delete(vendorTagAssignment)
          .where(eq(vendorTagAssignment.vendorId, vendorRow.id));
        if (tagIds.length > 0) {
          await tx
            .insert(vendorTagAssignment)
            .values(tagIds.map((tagId) => ({ vendorId: vendorRow.id, tagId })));
        }
        return { vendorId: vendorRow.id };
      });
      vendraLog("officer.set_tags", {
        vendor: result.vendorId,
        count: input.tags.length,
      });
      return { tags: input.tags };
    }),
});

export type AppRouter = typeof appRouter;
