/**
 * GET /api/vendor/compliance-summary — the durable-state poll behind the
 * portal's category list, coverage readout, and activation gate (adaptive
 * cadence client-side: 5s determining → 15s stale → 30s idle).
 */
import { authFailureResponse, requireVendorContact } from "@/server/auth-guards";
import { buildComplianceSummary } from "@/server/compliance-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireVendorContact();
  if (!auth.ok) return authFailureResponse(auth.failure);
  const summary = await buildComplianceSummary(auth.ctx.vendor.id);
  return Response.json(summary);
}
