/**
 * GET /api/vendor/coverage-determination/stream — attach-only live progress
 * (SPEC §6.4): 204 when no live run on this instance (the client stays
 * on the poll); else subscribe to the in-process progress broadcast. All
 * parts are transient — durable state stays the polled summary.
 */
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import type { CoverageUIMessage } from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { authFailureResponse, requireVendorContact } from "@/server/auth-guards";
import {
  hasLiveCoverageRun,
  subscribeCoverageProgress,
} from "@/server/harness/coverage-progress";

export const runtime = "nodejs";
export const maxDuration = 900;
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireVendorContact();
  if (!auth.ok) return authFailureResponse(auth.failure);
  const vendorId = auth.ctx.vendor.id;

  if (!hasLiveCoverageRun(vendorId)) {
    return new Response(null, { status: 204 });
  }

  const stream = createUIMessageStream<CoverageUIMessage>({
    execute: async ({ writer }) => {
      const done = subscribeCoverageProgress(vendorId, writer);
      if (done) await done;
    },
  });
  return createUIMessageStreamResponse({ stream });
}
