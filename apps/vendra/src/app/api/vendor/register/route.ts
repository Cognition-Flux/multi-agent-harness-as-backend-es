/**
 * POST /api/vendor/register — public vendor-contact signup: creates the
 * better-auth user (SDK, never raw table writes), the vendor row in the
 * target org, and the server-side role/tenant linkage (auth-admin.ts —
 * roles are NEVER client-settable).
 */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@vendra/db-vendor";
import { vendraError, vendraLog } from "@vendra/workflow/vendor";

import { VENDOR_CONTACT_ROLE } from "@/server/auth";
import { createUserWithRole } from "@/server/auth-admin";
import { insertActivity } from "@/server/harness/db/documents";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  contactName: z.string().min(1).max(200),
  legalName: z.string().min(1).max(300),
  organizationSlug: z.string().min(1).default("acme-construction"),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Expected { email, password, contactName, legalName }" },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const db = getDb();

  const [org] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.slug, input.organizationSlug))
    .limit(1);
  if (!org) {
    return Response.json({ error: "Unknown organization" }, { status: 404 });
  }
  const [profile] = await db
    .select()
    .from(schema.vendorRequirementProfile)
    .where(eq(schema.vendorRequirementProfile.organizationId, org.id))
    .orderBy(asc(schema.vendorRequirementProfile.id))
    .limit(1);
  if (!profile) {
    return Response.json(
      { error: "Organization has no requirement profile configured" },
      { status: 409 },
    );
  }

  const [vendorRow] = await db
    .insert(schema.vendor)
    .values({
      organizationId: org.id,
      legalName: input.legalName,
      contactEmail: input.email,
      requirementProfileId: profile.id,
    })
    .returning();
  if (!vendorRow) {
    return Response.json({ error: "Vendor could not be created" }, { status: 500 });
  }

  try {
    await createUserWithRole({
      email: input.email,
      password: input.password,
      name: input.contactName,
      role: VENDOR_CONTACT_ROLE,
      organizationId: org.id,
      vendorId: vendorRow.id,
    });
  } catch (err) {
    // Transaction-equivalent rollback (spec §16 B10): the better-auth SDK
    // manages its own connection, so the vendor insert cannot share a DB
    // transaction with the user creation — compensate instead, and never let
    // a rollback failure mask the original error.
    try {
      await db.delete(schema.vendor).where(eq(schema.vendor.id, vendorRow.id));
    } catch (rollbackErr) {
      vendraError("register.rollback_failed", {
        vendor: vendorRow.id,
        error:
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      });
    }
    const message =
      err instanceof Error && /exists|taken|duplicate/i.test(err.message)
        ? "An account with this email already exists."
        : "The account could not be created.";
    return Response.json({ error: message }, { status: 409 });
  }

  await insertActivity({
    vendorId: vendorRow.id,
    organizationId: org.id,
    type: "VENDOR_REGISTERED",
    metadata: { legalName: input.legalName },
  });
  vendraLog("vendor.registered", { vendor: vendorRow.id, org: org.id });
  return Response.json({ ok: true, vendorUuid: vendorRow.uuid });
}
