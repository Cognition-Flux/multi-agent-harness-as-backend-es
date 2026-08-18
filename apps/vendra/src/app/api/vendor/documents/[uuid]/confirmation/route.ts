/**
 * POST /api/vendor/documents/[uuid]/confirmation — the vendor's answer to a
 * HITL prompt (SPEC §6.4). DB-FIRST: the answer wins the
 * durable window record before the in-memory waiter is poked, so it lands
 * even when this POST is served by a different instance than the one running
 * the pipeline (the owner's 5s poll delivers it).
 */
import { z } from "zod";

import { authFailureResponse, requireOwnedDocument } from "@/server/auth-guards";
import { answerConfirmation } from "@/server/harness/confirmations";

export const runtime = "nodejs";

const bodySchema = z.object({
  confirmationUuid: z.string().uuid(),
  confirmed: z.boolean(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid: documentUuid } = await params;
  // Guard BEFORE parsing (spec §16 B9): validating first handed
  // unauthenticated callers a 400-vs-401 oracle over the body shape.
  const auth = await requireOwnedDocument(documentUuid);
  if (!auth.ok) return authFailureResponse(auth.failure);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Expected { confirmationUuid, confirmed }" },
      { status: 400 },
    );
  }

  // The path's [uuid] must match the confirmation's document — a mismatched
  // POST cannot win another document's window.
  const result = await answerConfirmation({
    documentId: auth.run.document.id,
    documentUuid,
    confirmationUuid: parsed.data.confirmationUuid,
    confirmed: parsed.data.confirmed,
  });
  if (!result.resolved) {
    return Response.json(
      { error: "Confirmation not found or already settled" },
      { status: 404 },
    );
  }
  return Response.json({ resolved: true });
}
