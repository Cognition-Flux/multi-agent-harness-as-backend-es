/**
 * POST /api/vendor/admin/coverage-determination — the OFFICER mirror of the
 * coverage kick (SPEC §6.4): every officer surface that
 * renders coverage-determining state consumes one shared kick hook that
 * POSTs here. Load-bearing under the policy-purge lever — a purged
 * determination otherwise shows "determining" indefinitely on a sandbox-free
 * read path.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@vendra/db-vendor";

import { authFailureResponse, requireComplianceOfficer } from "@/server/auth-guards";
import { runCoverageDetermination } from "@/server/harness/coverage-runner";
import { vendraLog } from "@/server/harness/log";

export const runtime = "nodejs";

const bodySchema = z.object({ vendorUuid: z.string().uuid() });

export async function POST(req: Request) {
  const auth = await requireComplianceOfficer();
  if (!auth.ok) return authFailureResponse(auth.failure);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { vendorUuid }" }, { status: 400 });
  }
  const [vendorRow] = await getDb()
    .select({ id: schema.vendor.id, organizationId: schema.vendor.organizationId })
    .from(schema.vendor)
    .where(eq(schema.vendor.uuid, parsed.data.vendorUuid))
    .limit(1);
  if (!vendorRow || vendorRow.organizationId !== auth.ctx.organization.id) {
    return Response.json({ error: "Vendor not found" }, { status: 404 });
  }

  vendraLog("coverage.determination.kicked", {
    vendor: vendorRow.id,
    source: "officer",
  });
  runCoverageDetermination(vendorRow.id);
  return Response.json({ triggered: true }, { status: 202 });
}
