/**
 * DELETE /api/vendor/documents/[uuid] — delete a document (SPEC §6.4).
 * Blocked while PROCESSING/UPLOADING (in-flight runs are never orphaned →
 * 409); deletes the row + best-effort storage object, then recompute +
 * coverage-lane kick — the delete-cycle contract (§13.2): deleting an
 * umbrella policy flips a stacked category back live.
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";

import { authFailureResponse, requireOwnedDocument } from "@/server/auth-guards";
import { runCoverageDetermination } from "@/server/harness/coverage-runner";
import { insertActivity } from "@/server/harness/db/documents";
import { vendraLog, vendraWarn } from "@/server/harness/log";
import { recomputeBestEffort } from "@/server/recompute";
import { deleteDocumentObject } from "@/server/storage";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid: documentUuid } = await params;
  const auth = await requireOwnedDocument(documentUuid);
  if (!auth.ok) return authFailureResponse(auth.failure);
  const { run } = auth;

  if (
    run.document.uploadStatus === "PROCESSING" ||
    run.document.uploadStatus === "UPLOADING"
  ) {
    vendraWarn("document.delete_blocked", {
      doc: documentUuid,
      status: run.document.uploadStatus,
    });
    return Response.json(
      { error: "Document is processing — try again once it finishes." },
      { status: 409 },
    );
  }

  await getDb()
    .delete(schema.vendorDocument)
    .where(eq(schema.vendorDocument.id, run.document.id));
  await deleteDocumentObject(run.document.fileKey).catch(() => undefined);
  await insertActivity({
    vendorId: run.vendor.id,
    organizationId: run.document.organizationId,
    type: "DOCUMENT_DELETED",
    actorUserId: auth.user.id,
    metadata: { documentUuid, fileKey: run.document.fileKey },
  });
  vendraLog("document.deleted", { doc: documentUuid, vendor: run.vendor.id });

  await recomputeBestEffort(run.vendor.id);
  runCoverageDetermination(run.vendor.id);
  return Response.json({ deleted: true });
}
