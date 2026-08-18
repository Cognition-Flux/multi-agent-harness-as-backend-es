/**
 * GET /api/vendor/documents — the documents snapshot the vendor portal polls
 * (~10s while any doc is processing; also the officer→vendor propagation
 * channel, §8.5). Best-effort janitor first — errors never break the
 * snapshot.
 */
import { authFailureResponse, requireVendorContact } from "@/server/auth-guards";
import { loadDocumentsSnapshot } from "@/server/harness/db/page-load";
import { runJanitor } from "@/server/harness/janitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireVendorContact();
  if (!auth.ok) return authFailureResponse(auth.failure);

  await runJanitor(auth.ctx.vendor.id);
  const documents = await loadDocumentsSnapshot(auth.ctx.vendor.id);
  return Response.json(documents);
}
