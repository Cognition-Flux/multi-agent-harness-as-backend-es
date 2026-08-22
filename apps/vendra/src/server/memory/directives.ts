/**
 * Directive-outcome consolidation (SPEC §24.6): when a superadmin resolves a
 * directive proposal, the outcome becomes ORG-scoped memories every vendor
 * conversation of that company can recall.
 *
 * One fact per knob touched, so a later approval on the same knob supersedes
 * exactly its predecessor (Postgres first, then a best-effort index delete —
 * mem0 3.1.6 is additive-only, `--rebuild` is the guaranteed cleanup).
 * Rejections become ONE fact with no knob key: they inform ("this was asked
 * and declined") without ever superseding an approved directive.
 *
 * Everything here is best-effort BY DESIGN: it runs post-transaction from the
 * approval path, and a memory hiccup must never un-approve a policy. Failures
 * log and return.
 */
import {
  VALIDATOR_LABELS,
  listDocumentTypeCatalog,
  requirementCategoryLabel,
  type DirectiveDiff,
  type VendorValidatorId,
} from "@vendra/workflow/vendor";

import { vendraError, vendraLog, vendraWarn } from "@/server/harness/log";

import { orgScopeKey } from "./config";
import { supersedeDirectiveFactsByKnob } from "./db";
import { recordFacts } from "./ingest";
import { getMemoryClient } from "./mem0-client";
import { redactMemoryFact } from "./redact";

function documentTitle(type: string): string {
  return (
    listDocumentTypeCatalog().find((entry) => entry.type === type)?.title ?? type
  );
}

function validatorLabel(id: string): string {
  return VALIDATOR_LABELS[id as VendorValidatorId] ?? id;
}

function joinNames(values: readonly string[]): string {
  return values.join(", ");
}

/**
 * The diff as short Spanish lines — shared by the console's proposal card, the
 * assistant's `getDirectiveProposals` summaries, and the memory facts, so the
 * three surfaces never describe one change three ways.
 */
export function summarizeDirectiveDiffLines(diff: DirectiveDiff): string[] {
  const lines: string[] = [];
  if (diff.acceptDocumentTypes?.length) {
    lines.push(`Aceptar: ${joinNames(diff.acceptDocumentTypes.map(documentTitle))}.`);
  }
  if (diff.dropDocumentTypes?.length) {
    lines.push(
      `Dejar de aceptar: ${joinNames(diff.dropDocumentTypes.map(documentTitle))}.`,
    );
  }
  for (const change of diff.fieldChanges ?? []) {
    const parts: string[] = [];
    if (change.addFields?.length) parts.push(`añadir ${joinNames(change.addFields)}`);
    if (change.removeFields?.length) parts.push(`quitar ${joinNames(change.removeFields)}`);
    if (parts.length > 0) {
      lines.push(`Campos de ${documentTitle(change.documentType)}: ${parts.join("; ")}.`);
    }
  }
  for (const change of diff.validatorChanges ?? []) {
    const parts: string[] = [];
    if (change.addValidators?.length) {
      parts.push(`añadir ${joinNames(change.addValidators.map(validatorLabel))}`);
    }
    if (change.removeValidators?.length) {
      parts.push(`quitar ${joinNames(change.removeValidators.map(validatorLabel))}`);
    }
    if (parts.length > 0) {
      lines.push(
        `Validaciones de ${documentTitle(change.documentType)}: ${parts.join("; ")}.`,
      );
    }
  }
  if (diff.makeRefereeable?.length) {
    lines.push(
      `El sistema decide automáticamente: ${joinNames(diff.makeRefereeable.map(requirementCategoryLabel))}.`,
    );
  }
  if (diff.makeReferred?.length) {
    lines.push(
      `Requieren aprobación de un oficial: ${joinNames(diff.makeReferred.map(requirementCategoryLabel))}.`,
    );
  }
  return lines;
}

/** One memory fact per knob the diff touches (§24.6). */
function factsPerKnob(
  diff: DirectiveDiff,
  stamp: string,
): { knobKey: string; fact: string }[] {
  const facts: { knobKey: string; fact: string }[] = [];
  for (const type of diff.acceptDocumentTypes ?? []) {
    facts.push({
      knobKey: `doc:${type}`,
      fact: `${stamp}: la empresa acepta ${documentTitle(type)}.`,
    });
  }
  for (const type of diff.dropDocumentTypes ?? []) {
    facts.push({
      knobKey: `doc:${type}`,
      fact: `${stamp}: la empresa dejó de aceptar ${documentTitle(type)}.`,
    });
  }
  for (const change of diff.fieldChanges ?? []) {
    const parts: string[] = [];
    if (change.addFields?.length) parts.push(`se añadieron ${joinNames(change.addFields)}`);
    if (change.removeFields?.length) parts.push(`se quitaron ${joinNames(change.removeFields)}`);
    if (parts.length === 0) continue;
    facts.push({
      knobKey: `field:${change.documentType}`,
      fact: `${stamp}: en los campos extraídos de ${documentTitle(change.documentType)} ${parts.join(" y ")}.`,
    });
  }
  for (const change of diff.validatorChanges ?? []) {
    const parts: string[] = [];
    if (change.addValidators?.length) {
      parts.push(`se añadieron ${joinNames(change.addValidators.map(validatorLabel))}`);
    }
    if (change.removeValidators?.length) {
      parts.push(`se quitaron ${joinNames(change.removeValidators.map(validatorLabel))}`);
    }
    if (parts.length === 0) continue;
    facts.push({
      knobKey: `val:${change.documentType}`,
      fact: `${stamp}: en las validaciones de ${documentTitle(change.documentType)} ${parts.join(" y ")}.`,
    });
  }
  for (const category of diff.makeRefereeable ?? []) {
    facts.push({
      knobKey: `cat:${category}`,
      fact: `${stamp}: el sistema decide ${requirementCategoryLabel(category)} automáticamente.`,
    });
  }
  for (const category of diff.makeReferred ?? []) {
    facts.push({
      knobKey: `cat:${category}`,
      fact: `${stamp}: ${requirementCategoryLabel(category)} requiere la aprobación de un oficial en cada proveedor.`,
    });
  }
  return facts;
}

export interface DirectiveOutcomeInput {
  organization: { id: number; uuid: string };
  diff: DirectiveDiff;
  /** The raising vendor's display name, for the rejection fact. */
  vendorName: string | null;
  approved: boolean;
  /** The activated version, when approved. */
  appliedVersion: number | null;
  resolutionNote: string | null;
  /** ISO date (YYYY-MM-DD) of the resolution — passed in, never Date.now here. */
  dateIso: string;
}

/**
 * Consolidate a resolved proposal into org-scoped memories. Best-effort; a
 * failure is logged and swallowed (the approval already committed).
 */
export async function consolidateDirectiveOutcome(
  input: DirectiveOutcomeInput,
): Promise<void> {
  const scopeKey = orgScopeKey(input.organization.uuid);
  const target = {
    vendorId: null,
    organizationId: input.organization.id,
    vendorUuid: scopeKey,
    threadId: scopeKey,
  };
  try {
    if (input.approved) {
      const stamp = `Directiva aprobada el ${input.dateIso}${
        input.appliedVersion !== null ? ` (política v${input.appliedVersion})` : ""
      }`;
      const perKnob = factsPerKnob(input.diff, stamp);
      if (perKnob.length === 0) return;
      // Supersede the previous directive fact for each touched knob FIRST, so
      // the recency fallback never ranks the old rule above the new one.
      const { mem0MemoryIds } = await supersedeDirectiveFactsByKnob(
        scopeKey,
        perKnob.map((f) => f.knobKey),
      );
      if (mem0MemoryIds.length > 0) {
        try {
          const client = await getMemoryClient();
          if (client) {
            for (const id of mem0MemoryIds) await client.delete(id);
          }
        } catch (err) {
          // Additive-only index: the stale point keeps matching until a
          // rebuild. Postgres already superseded it, so this is degradation,
          // not loss (§24.6).
          vendraWarn("memory.directive_index_delete_failed", {
            org: input.organization.uuid,
            ids: mem0MemoryIds.length,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      for (const { knobKey, fact } of perKnob) {
        await recordFacts(target, [redactMemoryFact(fact)], {
          source: "directive",
          knobKey,
        });
      }
      vendraLog("memory.directive_consolidated", {
        org: input.organization.uuid,
        facts: perKnob.length,
        superseded: mem0MemoryIds.length,
      });
    } else {
      const summary = summarizeDirectiveDiffLines(input.diff).join(" ");
      const fact = redactMemoryFact(
        `El ${input.dateIso} se rechazó la propuesta${
          input.vendorName ? ` de ${input.vendorName}` : ""
        }: ${summary}${input.resolutionNote ? ` Motivo: ${input.resolutionNote}` : ""}`,
      );
      await recordFacts(target, [fact], { source: "directive", knobKey: null });
      vendraLog("memory.directive_rejection_recorded", {
        org: input.organization.uuid,
      });
    }
  } catch (err) {
    vendraError("memory.directive_consolidation_failed", {
      org: input.organization.uuid,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
