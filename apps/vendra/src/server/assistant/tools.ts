/**
 * Host-executed tools for the vendor assistant's Claude Code session.
 *
 * All reads flow through the snapshot module (same derivations as the
 * page); the writes are the memory service and (EMPOWERED only, SPEC §24) the
 * directive-proposal queue. Every tool soft-fails with { ok: false, note } —
 * a thrown tool error would kill the live stream.
 *
 * ALL FIVE tools are always BUILT; what the model can CALL is the
 * `activeTools` allowlist the session lease derives from the vendor's resolved
 * privilege tier (`assistantActiveTools`, §24.5). The privilege re-check inside
 * `proposeDirectiveChange` is defense in depth behind that gate, never the
 * gate itself.
 */
import { tool } from "ai";
import { and, asc, count, eq } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import {
  applyDirectiveDiff,
  assistantToolNamesForPrivilege,
  extractionFieldNames,
  listDocumentTypeCatalog,
  requirementCategoryLabel,
  REQUIREMENT_CATEGORY_VALUES,
  VALIDATOR_LABELS,
  VALIDATORS_BY_DOCUMENT_TYPE,
  type AssistantPrivilege,
  type DirectiveDiff,
  type VendorDocumentType,
  type VendorValidatorId,
} from "@vendra/workflow/vendor";

import { vendraError, vendraLog } from "@/server/harness/log";

import {
  getComplianceStateInputSchema,
  getDocumentDetailsInputSchema,
  getDirectiveProposalsInputSchema,
  proposeDirectiveChangeInputSchema,
  rememberFactsInputSchema,
  type AssistantDirectiveProposal,
  type ProposeDirectiveChangeInput,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";

import { loadActiveCompanyPolicy } from "@/server/company-policy";
import { COMPLIANCE_OFFICER_ROLE } from "@/server/auth";
import {
  createDirectiveProposal,
  getOpenProposalForVendor,
  listProposalsForVendor,
} from "@/server/directive-proposals";
import { summarizeDirectiveDiffLines } from "@/server/memory/directives";
import { redactMemoryFact } from "@/server/memory/redact";
import { evaluateAdmission } from "@/server/policy-admission";
import { strictestThresholds } from "@/server/profile";

import { rememberFacts } from "./memory";
import { buildComplianceState, buildDocumentDetails } from "./snapshot";

export interface AssistantToolContext {
  vendorUuid: string;
  vendorId: number;
  organizationId: number;
  organizationUuid: string;
  /** Resolved from the vendor's pinned policy at lease time (§24.5). */
  privilege: AssistantPrivilege;
}

export type AssistantToolName = keyof ReturnType<typeof buildAssistantTools> &
  string;

/**
 * The activeTools allowlist for one lease — the pure roster, narrowed to the
 * tool-set's key type. The cast is safe by construction:
 * `verify-engine-invariants.ts` asserts both rosters name exactly these tools.
 */
export function assistantActiveTools(
  privilege: AssistantPrivilege,
): AssistantToolName[] {
  return assistantToolNamesForPrivilege(privilege) as AssistantToolName[];
}

/**
 * Resolve the model's names to engine identifiers. The live e2e round caught
 * the exact failure this exists for: the model proposed `"W-8BEN-E"` (the
 * human title) and `"Historial de seguridad"` (the Spanish label) — and while
 * ADDED unknowns are refused by the gate, unknowns in DROP/REMOVE lists were
 * silently vacuous, persisting an admissible proposal that changed NOTHING.
 * Every name must therefore resolve — id first, then label — or the whole
 * call soft-fails with the valid vocabulary so the model can retry precisely.
 */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function makeResolver(
  entries: readonly { id: string; labels: readonly string[] }[],
): (value: string) => string | null {
  const byName = new Map<string, string>();
  for (const entry of entries) {
    byName.set(normalizeName(entry.id), entry.id);
    for (const label of entry.labels) byName.set(normalizeName(label), entry.id);
  }
  return (value) => byName.get(normalizeName(value)) ?? null;
}

function resolveDirectiveDiff(
  input: ProposeDirectiveChangeInput,
): { ok: true; diff: DirectiveDiff } | { ok: false; note: string } {
  const catalog = listDocumentTypeCatalog();
  const resolveType = makeResolver(
    catalog.map((entry) => ({
      id: entry.type,
      labels: [entry.title, entry.displayName],
    })),
  );
  const resolveCategory = makeResolver(
    REQUIREMENT_CATEGORY_VALUES.map((category) => ({
      id: category,
      labels: [requirementCategoryLabel(category)],
    })),
  );
  const resolveValidator = makeResolver(
    (Object.keys(VALIDATOR_LABELS) as VendorValidatorId[]).map((id) => ({
      id,
      labels: [VALIDATOR_LABELS[id]],
    })),
  );
  const unresolved: string[] = [];
  const list = (
    values: readonly string[] | undefined,
    resolve: (value: string) => string | null,
  ): string[] | undefined =>
    values?.map((value) => {
      const id = resolve(value);
      if (!id) unresolved.push(value);
      return id ?? value;
    });

  const diff: DirectiveDiff = {
    acceptDocumentTypes: list(input.acceptDocumentTypes, resolveType),
    dropDocumentTypes: list(input.dropDocumentTypes, resolveType),
    fieldChanges: input.fieldChanges?.map((change) => {
      const type = resolveType(change.documentType);
      if (!type) unresolved.push(change.documentType);
      // Field names are exact ids the model reads from getDocumentDetails;
      // additions the gate refuses (`unknown_field`), removals of unknown
      // names are vacuous and harmless.
      return { ...change, documentType: type ?? change.documentType };
    }),
    validatorChanges: input.validatorChanges?.map((change) => {
      const type = resolveType(change.documentType);
      if (!type) unresolved.push(change.documentType);
      return {
        documentType: type ?? change.documentType,
        addValidators: list(change.addValidators, resolveValidator),
        removeValidators: list(change.removeValidators, resolveValidator),
      };
    }),
    makeRefereeable: list(input.makeRefereeable, resolveCategory),
    makeReferred: list(input.makeReferred, resolveCategory),
  };
  if (unresolved.length > 0) {
    return {
      ok: false,
      note: `Unknown identifiers: ${[...new Set(unresolved)].join(", ")}. Use exact ids — document types: ${catalog
        .map((entry) => entry.type)
        .join(", ")}; categories: ${REQUIREMENT_CATEGORY_VALUES.join(", ")}.`,
    };
  }
  return { ok: true, diff };
}

/** Canonical projection for "does this diff actually change anything?". */
function policyFingerprint(policy: {
  refereeableCategories: readonly string[];
  documents: readonly { documentType: string; extractFields: readonly string[]; validators: readonly string[] }[];
}): string {
  return JSON.stringify({
    refereeable: [...policy.refereeableCategories].sort(),
    documents: [...policy.documents]
      .map((doc) => ({
        type: doc.documentType,
        fields: [...doc.extractFields].sort(),
        validators: [...doc.validators].sort(),
      }))
      .sort((a, b) => a.type.localeCompare(b.type)),
  });
}

/** Build the five host tools bound to one vendor's chat session. */
export function buildAssistantTools(ctx: AssistantToolContext) {
  const getComplianceState = tool({
    description:
      "Get the vendor's whole compliance record right now: requirement categories with status, the activation gate, every uploaded document with processing/validation state, the insurance-coverage determination, and upcoming expirations. Call before answering any status/progress question.",
    inputSchema: getComplianceStateInputSchema,
    execute: async () => {
      try {
        return await buildComplianceState(ctx.vendorId);
      } catch (err) {
        vendraError("assistant.tool_failed", {
          vendor: ctx.vendorUuid,
          tool: "getComplianceState",
          err: err instanceof Error ? err.message : String(err),
        });
        return {
          ok: false,
          note: "Compliance state is unavailable right now.",
        };
      }
    },
  });

  const getDocumentDetails = tool({
    description:
      "Get one uploaded document in depth: classification reasoning, extracted fields, and per-rule validation results. Use the documentUuid from getComplianceState.",
    inputSchema: getDocumentDetailsInputSchema,
    execute: async ({ documentUuid }) => {
      try {
        const details = await buildDocumentDetails(
          ctx.vendorId,
          documentUuid,
        );
        return (
          details ?? { ok: false, note: "No document with that id exists." }
        );
      } catch (err) {
        vendraError("assistant.tool_failed", {
          vendor: ctx.vendorUuid,
          tool: "getDocumentDetails",
          err: err instanceof Error ? err.message : String(err),
        });
        return {
          ok: false,
          note: "Document details are unavailable right now.",
        };
      }
    },
  });

  const rememberFactsTool = tool({
    description:
      "Store up to 5 short durable facts the vendor told you about their business, for future sessions. Never store assistant output, document contents, or contact/tax details.",
    inputSchema: rememberFactsInputSchema,
    execute: async ({ facts }) => {
      const stored = await rememberFacts(
        ctx.vendorUuid,
        ctx.vendorId,
        facts,
        ctx.vendorUuid,
      );
      return { stored };
    },
  });

  const proposeDirectiveChange = tool({
    description:
      "Draft a proposal to change this company's document-processing directives: accepted document types, extracted fields, validators, or which requirement categories the system settles automatically. This is ONLY a proposal — the platform superadmin reviews it and nothing changes unless they approve. One open proposal at a time.",
    inputSchema: proposeDirectiveChangeInputSchema,
    execute: async (input) => {
      try {
        // Defense in depth: activeTools already hides this tool below
        // EMPOWERED; a stale/parked session still cannot cross the gate.
        if (ctx.privilege !== "EMPOWERED") {
          return {
            ok: false as const,
            note: "This company has not enabled directive proposals.",
          };
        }
        const base = await loadActiveCompanyPolicy(ctx.organizationId);
        if (!base) {
          return { ok: false as const, note: "No active policy to propose against." };
        }
        if (await getOpenProposalForVendor(ctx.vendorId)) {
          return {
            ok: false as const,
            note: "An earlier proposal is still awaiting review — one at a time.",
          };
        }
        const resolved = resolveDirectiveDiff(input);
        if (!resolved.ok) return { ok: false as const, note: resolved.note };
        const diff = resolved.diff;
        const proposed = applyDirectiveDiff(base, diff, {
          fieldsOf: (type) => extractionFieldNames(type as VendorDocumentType) ?? [],
          validatorsOf: (type) => [
            ...(VALIDATORS_BY_DOCUMENT_TYPE[type as VendorDocumentType] ?? []),
          ],
        });
        // A diff whose knobs all resolved but that changes NOTHING must not
        // reach the superadmin as a question with no content.
        if (policyFingerprint(proposed) === policyFingerprint(base)) {
          return {
            ok: false as const,
            note: "The proposed changes are already the company's current policy — nothing to propose.",
          };
        }
        const db = getDb();
        const profiles = await db
          .select()
          .from(schema.vendorRequirementProfile)
          .where(eq(schema.vendorRequirementProfile.organizationId, ctx.organizationId))
          .orderBy(asc(schema.vendorRequirementProfile.id));
        const [officers] = await db
          .select({ n: count() })
          .from(schema.user)
          .where(
            and(
              eq(schema.user.organizationId, ctx.organizationId),
              eq(schema.user.role, COMPLIANCE_OFFICER_ROLE),
            ),
          );
        // Advisory dry-run (§24.4): stored on the row, reported to the model;
        // the authoritative gate runs again at approval.
        const decision = await evaluateAdmission({
          policy: proposed,
          profiles: profiles.map((p) => ({
            required: p.required,
            mandatory: p.mandatory,
          })),
          thresholds: strictestThresholds(profiles),
          company: { officerCount: officers?.n ?? 0 },
        });
        const { uuid } = await createDirectiveProposal({
          organizationId: ctx.organizationId,
          vendorId: ctx.vendorId,
          basePolicyId: base.id,
          diff,
          proposedPolicy: proposed,
          rationale: redactMemoryFact(input.rationale),
          gateVerdict: decision,
        });
        vendraLog("assistant.directive_proposed", {
          vendor: ctx.vendorUuid,
          proposal: uuid,
          admissible: decision.admissible,
          rationaleLen: input.rationale.length,
        });
        return {
          ok: true as const,
          proposalUuid: uuid,
          admissible: decision.admissible,
          // Enum-precise English details — the assistant explains in Spanish.
          violations: decision.violations,
        };
      } catch (err) {
        vendraError("assistant.tool_failed", {
          vendor: ctx.vendorUuid,
          tool: "proposeDirectiveChange",
          err: err instanceof Error ? err.message : String(err),
        });
        return { ok: false as const, note: "Could not draft the proposal right now." };
      }
    },
  });

  const getDirectiveProposals = tool({
    description:
      "List THIS vendor's own directive-change proposals and their review status (open, approved, rejected, or superseded).",
    inputSchema: getDirectiveProposalsInputSchema,
    execute: async () => {
      try {
        const rows = await listProposalsForVendor(ctx.vendorId);
        const proposals: AssistantDirectiveProposal[] = rows.map((row) => ({
          proposalUuid: row.uuid,
          raisedAt: row.raisedAt.toISOString(),
          resolution:
            (row.resolution as AssistantDirectiveProposal["resolution"]) ?? null,
          resolutionNote: row.resolutionNote,
          admissible:
            (row.gateVerdict as { admissible?: boolean } | null)?.admissible ??
            null,
          summary: summarizeDirectiveDiffLines(row.diff as DirectiveDiff).join(" "),
        }));
        return { proposals };
      } catch (err) {
        vendraError("assistant.tool_failed", {
          vendor: ctx.vendorUuid,
          tool: "getDirectiveProposals",
          err: err instanceof Error ? err.message : String(err),
        });
        return { ok: false as const, note: "Proposals are unavailable right now." };
      }
    },
  });

  return {
    getComplianceState,
    getDocumentDetails,
    rememberFacts: rememberFactsTool,
    proposeDirectiveChange,
    getDirectiveProposals,
  };
}
