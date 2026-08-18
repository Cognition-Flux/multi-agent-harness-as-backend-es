/**
 * POST /api/vendor/activate — the activation gate (SPEC §7.4). The
 * client's gate math is instant UX only; the SERVER re-derives the same math
 * here — the client is never trusted — with a three-tier refusal:
 *   determining      → 412 "still verifying… try again shortly"
 *   mandatory-missing → 400 NAMING the categories
 *   else blocking     → 400 the generic count refusal
 * Success → PRE_APPROVED (+ status-transition row + activity).
 */
import { eq, sql } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import { requirementCategoryLabel } from "@vendra/workflow/vendor";

import { authFailureResponse, requireVendorContact } from "@/server/auth-guards";
import { insertActivity } from "@/server/harness/db/documents";
import { vendraLog, vendraWarn } from "@/server/harness/log";
import { loadVendorEvidence } from "@/server/recompute";

export const runtime = "nodejs";

const ACTIVATED_STATUSES = new Set([
  "PRE_APPROVED",
  "NEED_REVIEW",
  "APPROVED",
]);

export async function POST() {
  const auth = await requireVendorContact();
  if (!auth.ok) return authFailureResponse(auth.failure);
  const vendorId = auth.ctx.vendor.id;
  const db = getDb();

  const loaded = await loadVendorEvidence(db, vendorId, new Date());
  const { vendorRow, evidence, gate } = loaded;

  if (ACTIVATED_STATUSES.has(vendorRow.complianceStatus)) {
    return Response.json({ activated: true, already: true });
  }

  // Round-2 hardening B3: a rejection is an officer decision — the vendor
  // cannot flip themselves back to PRE_APPROVED. (EXPIRED stays self-serve.)
  if (vendorRow.complianceStatus === "REJECTED") {
    vendraWarn("activate.rejected", { vendor: vendorId, reason: "status_rejected" });
    return Response.json(
      {
        error:
          "Your account was rejected by the compliance team — contact them to proceed.",
      },
      { status: 403 },
    );
  }

  const determining = [...evidence.byCategory.values()].some((c) => c.determining);
  if (determining) {
    vendraWarn("activate.rejected", { vendor: vendorId, reason: "determining" });
    return Response.json(
      {
        error:
          "We're still verifying your insurance coverage — try again in a moment.",
      },
      { status: 412 },
    );
  }
  if (!gate.cleared) {
    if (gate.missingMandatory.length > 0 && gate.blocking.length === 0) {
      const labels = gate.missingMandatory
        .map((c) => requirementCategoryLabel(c))
        .join(", ");
      vendraWarn("activate.rejected", {
        vendor: vendorId,
        reason: "mandatory_missing",
        missing: gate.missingMandatory.join(","),
      });
      return Response.json(
        { error: `${labels} must be verified before you can activate.` },
        { status: 400 },
      );
    }
    vendraWarn("activate.rejected", {
      vendor: vendorId,
      reason: "blocking",
      blocking: gate.blocking.join(","),
    });
    return Response.json(
      {
        error: `${gate.blocking.length} requirement ${gate.blocking.length === 1 ? "category" : "categories"} still need documents before you can activate.`,
        blocking: gate.blocking,
      },
      { status: 400 },
    );
  }

  await db
    .update(schema.vendor)
    .set({ complianceStatus: "PRE_APPROVED", updatedAt: sql`now()` })
    .where(eq(schema.vendor.id, vendorId));
  await db.insert(schema.vendorStatusTransition).values({
    vendorId,
    fromStatus: vendorRow.complianceStatus,
    toStatus: "PRE_APPROVED",
    source: "gate",
    actorUserId: auth.ctx.user.id,
  });
  await insertActivity({
    vendorId,
    organizationId: auth.ctx.organization.id,
    type: "ACTIVATION_SUBMITTED",
    actorUserId: auth.ctx.user.id,
    metadata: { from: vendorRow.complianceStatus },
  });
  vendraLog("activate.submitted", { vendor: vendorId });
  return Response.json({ activated: true });
}
