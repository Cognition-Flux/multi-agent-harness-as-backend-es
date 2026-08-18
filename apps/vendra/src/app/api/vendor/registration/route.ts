/**
 * PATCH /api/vendor/registration — the vendor registration form (SPEC
 * §7.1): legal entity details + work profile (drives conditional
 * dismissals) + the capped "Not applicable" toggles. EIN is never accepted
 * here — TIN last-4 comes exclusively from a verified W-9/W-8 extraction.
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@vendra/db-vendor";
import {
  REQUIREMENT_CATEGORY_VALUES,
  deriveAutoDismissedCategories,
} from "@vendra/workflow/vendor";

import { authFailureResponse, requireVendorContact } from "@/server/auth-guards";
import { vendraLog } from "@/server/harness/log";
import { toRequirementProfile, toWorkProfile } from "@/server/profile";
import { recomputeBestEffort } from "@/server/recompute";

export const runtime = "nodejs";

const bodySchema = z.object({
  legalName: z.string().min(1).max(300).optional(),
  dbaName: z.string().max(300).nullable().optional(),
  entityType: z.string().max(100).nullable().optional(),
  naicsCode: z.string().max(10).nullable().optional(),
  workProfile: z
    .object({
      remoteOnly: z.boolean().optional(),
      onSite: z.boolean().optional(),
      states: z.array(z.string().length(2)).max(60).optional(),
    })
    .optional(),
  dismissedCategories: z
    .array(z.enum(REQUIREMENT_CATEGORY_VALUES))
    .max(REQUIREMENT_CATEGORY_VALUES.length)
    .optional(),
  registered: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireVendorContact();
  if (!auth.ok) return authFailureResponse(auth.failure);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid registration payload" }, { status: 400 });
  }
  const input = parsed.data;
  const { vendor: vendorRow, profile } = auth.ctx;

  // Server-side dismissal filtering: only profile-dismissible, never
  // mandatory (the gate math re-filters, but don't persist junk).
  let dismissed: string[] | undefined;
  if (input.dismissedCategories) {
    const dismissible = new Set(profile.dismissible ?? []);
    const mandatory = new Set(profile.mandatory ?? []);
    dismissed = input.dismissedCategories.filter(
      (c) => dismissible.has(c) && !mandatory.has(c),
    );
    // Round-2 hardening B1: the manual-dismissal cap is enforced at persist
    // time — an over-cap payload used to persist and be silently sliced by
    // the gate. Auto-dismissals (remote-only) never count against the cap.
    const requirementProfile = toRequirementProfile(profile);
    const effectiveWorkProfile = toWorkProfile(
      input.workProfile !== undefined ? input.workProfile : vendorRow.workProfile,
    );
    const autoDismissed = new Set<string>(
      deriveAutoDismissedCategories(requirementProfile, effectiveWorkProfile),
    );
    // The persisted array is the PURE manual list: auto-dismissed categories
    // are derived from the work profile at gate time, and letting them into
    // the array would make the gate's cap slice count them against the
    // manual budget (a different count than this guard enforces).
    dismissed = dismissed.filter((c) => !autoDismissed.has(c));
    if (dismissed.length > requirementProfile.maxManualDismissable) {
      const max = requirementProfile.maxManualDismissable;
      return Response.json(
        {
          error: `You can mark at most ${max} requirement${max === 1 ? "" : "s"} as not applicable.`,
        },
        { status: 400 },
      );
    }
  }

  await getDb()
    .update(schema.vendor)
    .set({
      ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
      ...(input.dbaName !== undefined ? { dbaName: input.dbaName } : {}),
      ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
      ...(input.naicsCode !== undefined ? { naicsCode: input.naicsCode } : {}),
      ...(input.workProfile !== undefined ? { workProfile: input.workProfile } : {}),
      ...(dismissed !== undefined ? { dismissedCategories: dismissed } : {}),
      ...(input.registered ? { registeredAt: sql`COALESCE(${schema.vendor.registeredAt}, now())` } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(schema.vendor.id, vendorRow.id));

  vendraLog("vendor.registration_saved", {
    vendor: vendorRow.id,
    dismissed: dismissed?.length ?? undefined,
  });
  // Dismissals + work profile change the gate — fold immediately.
  await recomputeBestEffort(vendorRow.id);
  return Response.json({ saved: true });
}
