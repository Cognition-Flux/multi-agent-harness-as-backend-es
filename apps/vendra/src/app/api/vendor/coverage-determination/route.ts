/**
 * POST /api/vendor/coverage-determination — fire-and-forget kick (SPEC
 * §6.4). Logs `coverage.determination.kicked` BEFORE the detach (a received
 * kick is otherwise server-invisible; the kicked→started gap anchors the
 * latency budget). The runner is per-vendor coalesced + signature-guarded,
 * so concurrent-surface kicks are cheap DB reads.
 */
import { authFailureResponse, requireVendorContact } from "@/server/auth-guards";
import { runCoverageDetermination } from "@/server/harness/coverage-runner";
import { vendraLog } from "@/server/harness/log";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireVendorContact();
  if (!auth.ok) return authFailureResponse(auth.failure);

  vendraLog("coverage.determination.kicked", {
    vendor: auth.ctx.vendor.id,
    source: "vendor",
  });
  runCoverageDetermination(auth.ctx.vendor.id);
  return Response.json({ triggered: true }, { status: 202 });
}
