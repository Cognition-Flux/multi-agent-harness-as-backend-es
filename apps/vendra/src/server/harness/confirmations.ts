/**
 * HITL confirmation windows (SPEC §6.2.1) — durable DB record + in-memory
 * waiter.
 *
 * Deliberately the durable-window pattern, NOT v7 `toolApproval`: the window
 * must survive page reloads and settle from any app instance, which
 * stream-scoped approvals cannot.
 *
 * - `createConfirmation` writes the durable record FIRST (degrades to
 *   memory-only if the write fails), then opens the window with an unref'd
 *   expiry timer and atomic timeout-vs-answer arbitration.
 * - Cross-instance answers arrive via a 5s DB poll; first durable answer
 *   wins.
 * - Expiry outcome: the window's `defaultAnswer` when known, else `timeout`
 *   FAIL-OPEN — processing continues rather than deadlocking the doc.
 *
 * Stashed on globalThis so dev-mode HMR reloads don't orphan waiters.
 */
import { env } from "@/env";

import type { ConfirmationKind } from "@/features/vendor-compliance/lib/vendor-harness-contract";
import {
  readConfirmation,
  recordConfirmationAnswer,
  settleConfirmationTimeout,
  writeConfirmationRaised,
} from "./db/confirmations";
import { vendraLog, vendraWarn } from "./log";

export type ConfirmationOutcome = "confirmed" | "denied" | "timeout";

export const CONFIRMATION_WINDOW_MS = 5 * 60 * 1000;

/** How often the owning process checks the DB for a cross-instance answer. */
const CONFIRMATION_DB_POLL_MS = 5_000;

export function confirmationQuestion(
  kind: ConfirmationKind,
  entityName: string | null,
): string {
  switch (kind) {
    case "PARENT_POLICY_COVERS_SUBSIDIARY":
      return `Esta póliza nombra a ${entityName ? `"${entityName}"` : "otra empresa"} como asegurado. ¿Es esa su empresa matriz y la cobertura de dicha empresa se extiende a su negocio?`;
    case "DBA_SAME_ENTITY":
      return `Este documento muestra ${entityName ? `el nombre "${entityName}"` : "otro nombre comercial"}. ¿Se trata de la misma empresa registrada bajo su razón social (es decir, un DBA o nombre comercial)?`;
    case "BLANKET_ENDORSEMENT_APPLIES":
      return "El certificado no indica la condición de asegurado adicional. ¿Aplica a esta relación un endoso general (blanket) de asegurado adicional en la póliza?";
  }
}

interface PendingConfirmation {
  documentId: number;
  resolve: (outcome: ConfirmationOutcome) => void;
  timer: NodeJS.Timeout;
}

const globalStore = globalThis as typeof globalThis & {
  __vendraConfirmationWaiters?: Map<string, PendingConfirmation>;
};

const waiters: Map<string, PendingConfirmation> =
  globalStore.__vendraConfirmationWaiters ??
  (globalStore.__vendraConfirmationWaiters = new Map());

export interface CreateConfirmationArgs {
  documentId: number;
  documentUuid: string;
  kind: ConfirmationKind;
  entityName: string | null;
  timeoutMs?: number;
  defaultAnswer?: boolean | null;
}

export interface CreatedConfirmation {
  confirmationUuid: string;
  question: string;
  expiresAt: string;
  outcome: Promise<ConfirmationOutcome>;
}

function expiryOutcome(defaultAnswer: boolean | null): ConfirmationOutcome {
  if (defaultAnswer === null) return "timeout";
  return defaultAnswer ? "confirmed" : "denied";
}

/**
 * Register a confirmation window and get a promise that settles exactly
 * once: an answer (local resolve or cross-instance via the DB poll) or the
 * expiry outcome.
 */
export async function createConfirmation(
  args: CreateConfirmationArgs,
): Promise<CreatedConfirmation> {
  const timeoutMs =
    args.timeoutMs ?? env.VENDOR_CONFIRMATION_WINDOW_MS ?? CONFIRMATION_WINDOW_MS;
  const defaultAnswer = args.defaultAnswer ?? null;
  const confirmationUuid = crypto.randomUUID();
  const raisedAt = new Date();
  const expiresAt = new Date(Date.now() + timeoutMs);
  const question = confirmationQuestion(args.kind, args.entityName);

  // Durable record first — the cross-instance answer surface. A failed write
  // degrades to memory-only, never blocks the pipeline.
  let dbBacked = false;
  try {
    dbBacked = await writeConfirmationRaised({
      confirmationUuid,
      documentId: args.documentId,
      kind: args.kind,
      question,
      entityName: args.entityName,
      defaultAnswer,
      raisedAt,
      expiresAt,
    });
  } catch (err) {
    vendraWarn("confirmation.record_write_failed", {
      doc: args.documentUuid,
      kind: args.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const outcome = new Promise<ConfirmationOutcome>((resolve) => {
    const timer = setTimeout(() => {
      void (async () => {
        if (!waiters.has(confirmationUuid)) return;
        let settled: ConfirmationOutcome = expiryOutcome(defaultAnswer);
        let viaExpiry = true;
        if (dbBacked) {
          try {
            // Atomic arbitration: exactly one of {answer, expiry} wins the
            // record. Losing means an answer landed — adopt it.
            const result = await settleConfirmationTimeout({
              confirmationUuid,
              outcomeVia: defaultAnswer === null ? "timeout" : "default",
              defaultAnswer,
            });
            if (!result.won && result.answer) {
              viaExpiry = false;
              settled = result.answer.confirmed ? "confirmed" : "denied";
            }
          } catch (err) {
            // Liveness over consistency — never hang the pipeline on the DB.
            vendraWarn("confirmation.timeout_arbitration_failed", {
              doc: args.documentUuid,
              kind: args.kind,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        waiters.delete(confirmationUuid);
        vendraLog("confirmation.expired", {
          doc: args.documentUuid,
          kind: args.kind,
          outcome: settled,
          via: viaExpiry
            ? defaultAnswer === null
              ? "timeout"
              : "default"
            : "late_answer",
        });
        resolve(settled);
      })();
    }, timeoutMs);
    timer.unref();
    waiters.set(confirmationUuid, {
      documentId: args.documentId,
      resolve,
      timer,
    });
  });

  // Cross-instance discovery: while the waiter is open, poll the record for
  // an answer another instance stamped. Recursive timeout, unref'd.
  if (dbBacked) {
    const poll = () => {
      const tick = setTimeout(() => {
        void (async () => {
          if (!waiters.has(confirmationUuid)) return;
          try {
            const record = await readConfirmation(confirmationUuid);
            if (record?.outcome === "answered" && record.answer !== null) {
              resolveConfirmation(
                confirmationUuid,
                record.answer,
                args.documentId,
              );
              return;
            }
          } catch {
            // Transient read failure — the next tick retries.
          }
          poll();
        })();
      }, CONFIRMATION_DB_POLL_MS);
      tick.unref();
    };
    poll();
  }

  return {
    confirmationUuid,
    question,
    expiresAt: expiresAt.toISOString(),
    outcome,
  };
}

/**
 * Resolve a pending confirmation from an answer THIS process can see.
 * Returns false when the uuid is unknown, already settled, or belongs to a
 * different document (path/body binding check).
 */
export function resolveConfirmation(
  confirmationUuid: string,
  confirmed: boolean,
  documentId: number,
): boolean {
  const pending = waiters.get(confirmationUuid);
  if (!pending) return false;
  if (pending.documentId !== documentId) return false;
  waiters.delete(confirmationUuid);
  clearTimeout(pending.timer);
  pending.resolve(confirmed ? "confirmed" : "denied");
  return true;
}

/**
 * DB-first answer entrypoint (the confirmation route): win the durable
 * record, then best-effort poke the local waiter (the owner's poll covers
 * the cross-instance case). Degraded fallback: when no record wins, a live
 * LOCAL waiter is still honored — a DB hiccup at raise time must not make
 * the window unanswerable.
 */
export async function answerConfirmation(args: {
  documentId: number;
  documentUuid: string;
  confirmationUuid: string;
  confirmed: boolean;
}): Promise<{ resolved: boolean }> {
  const record = await recordConfirmationAnswer({
    documentId: args.documentId,
    confirmationUuid: args.confirmationUuid,
    confirmed: args.confirmed,
  });
  if (record) {
    resolveConfirmation(args.confirmationUuid, args.confirmed, args.documentId);
    vendraLog("confirmation.answered", {
      doc: args.documentUuid,
      confirmed: args.confirmed,
      resolved: true,
      dbBacked: true,
    });
    return { resolved: true };
  }
  const resolvedLocally = resolveConfirmation(
    args.confirmationUuid,
    args.confirmed,
    args.documentId,
  );
  vendraLog("confirmation.answered", {
    doc: args.documentUuid,
    confirmed: args.confirmed,
    resolved: resolvedLocally,
    dbBacked: false,
  });
  return { resolved: resolvedLocally };
}
