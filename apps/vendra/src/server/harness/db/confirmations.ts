/**
 * Durable HITL confirmation records (SPEC §6.2.1) — a real table
 * (`document_confirmation`, §6.10), deliberately not jsonb metadata blobs.
 * Semantics:
 *
 * - raise = INSERT the window row (durable-first).
 * - answer = guarded UPDATE ("first durable answer wins"): only an OPEN
 *   window (outcome IS NULL) with the matching uuid takes the answer.
 * - timeout arbitration = guarded UPDATE; losing means an answer landed
 *   (possibly on another instance) — the caller adopts it.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";

const { documentConfirmation } = schema;

export type ConfirmationRow = typeof documentConfirmation.$inferSelect;

export interface RaiseConfirmationInput {
  confirmationUuid: string;
  documentId: number;
  kind: string;
  question: string;
  entityName: string | null;
  defaultAnswer: boolean | null;
  raisedAt: Date;
  expiresAt: Date;
}

/** Durable record first — returns false only when the INSERT failed. */
export async function writeConfirmationRaised(
  input: RaiseConfirmationInput,
): Promise<boolean> {
  await getDb().insert(documentConfirmation).values({
    uuid: input.confirmationUuid,
    documentId: input.documentId,
    kind: input.kind,
    question: input.question,
    entityName: input.entityName,
    defaultAnswer: input.defaultAnswer,
    raisedAt: input.raisedAt,
    expiresAt: input.expiresAt,
  });
  return true;
}

/**
 * Win the durable record with an answer. Returns the settled row when THIS
 * answer won; null when the window is unknown, already settled, or belongs
 * to a different document (path/body binding check).
 */
export async function recordConfirmationAnswer(args: {
  documentId: number;
  confirmationUuid: string;
  confirmed: boolean;
}): Promise<ConfirmationRow | null> {
  const rows = await getDb()
    .update(documentConfirmation)
    .set({
      answeredAt: sql`now()`,
      answer: args.confirmed,
      outcome: "answered",
    })
    .where(
      and(
        eq(documentConfirmation.uuid, args.confirmationUuid),
        eq(documentConfirmation.documentId, args.documentId),
        isNull(documentConfirmation.outcome),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Atomic timeout-vs-answer arbitration: exactly one of {answer, expiry} wins
 * the record. `won: false` means an answer landed — adopt it.
 */
export async function settleConfirmationTimeout(args: {
  confirmationUuid: string;
  outcomeVia: "timeout" | "default";
  defaultAnswer: boolean | null;
}): Promise<{ won: boolean; answer: { confirmed: boolean } | null }> {
  const db = getDb();
  const rows = await db
    .update(documentConfirmation)
    .set({
      outcome: args.outcomeVia,
      answer: args.defaultAnswer,
      answeredAt: sql`now()`,
    })
    .where(
      and(
        eq(documentConfirmation.uuid, args.confirmationUuid),
        isNull(documentConfirmation.outcome),
      ),
    )
    .returning({ id: documentConfirmation.id });
  if (rows.length > 0) return { won: true, answer: null };

  const [existing] = await db
    .select({ answer: documentConfirmation.answer, outcome: documentConfirmation.outcome })
    .from(documentConfirmation)
    .where(eq(documentConfirmation.uuid, args.confirmationUuid))
    .limit(1);
  if (existing?.outcome === "answered" && existing.answer !== null) {
    return { won: false, answer: { confirmed: existing.answer } };
  }
  return { won: false, answer: null };
}

/** Read one window row (the owner's cross-instance answer poll). */
export async function readConfirmation(
  confirmationUuid: string,
): Promise<ConfirmationRow | null> {
  const [row] = await getDb()
    .select()
    .from(documentConfirmation)
    .where(eq(documentConfirmation.uuid, confirmationUuid))
    .limit(1);
  return row ?? null;
}
