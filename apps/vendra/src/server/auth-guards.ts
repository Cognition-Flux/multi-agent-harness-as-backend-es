/**
 * The three route guards (SPEC §6.4) — a discriminated failure union
 * mapped to 401/403/404. Roles + org checks are server-side; the slug is
 * NEVER a permission input; ownership mismatches are indistinguishable from
 * missing (404).
 */
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { getDb, schema } from "@vendra/db-vendor";

import type { DocumentRunContext } from "@/server/harness/db/documents";
import { getDocumentRunContext } from "@/server/harness/db/documents";
import { vendraWarn } from "@/server/harness/log";
import { OFFICER_ROLES, VENDOR_CONTACT_ROLE, getSessionUser, type SessionUser } from "./auth";

const { organization, vendor, vendorRequirementProfile } = schema;

export type VendraAuthFailure =
  | { kind: "unauthorized" }
  | { kind: "not_found"; message: string };

export function authFailureResponse(failure: VendraAuthFailure): Response {
  // Every /api/vendor/* denial funnels through here — one auditable line
  // (SPEC §17 C5). Kind only: no identity or path details worth leaking.
  vendraWarn("auth.denied", { kind: failure.kind });
  switch (failure.kind) {
    case "unauthorized":
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    case "not_found":
      return Response.json({ error: failure.message }, { status: 404 });
  }
}

export interface VendorContactContext {
  user: SessionUser;
  organization: typeof organization.$inferSelect;
  vendor: typeof vendor.$inferSelect;
  profile: typeof vendorRequirementProfile.$inferSelect;
}

export type VendorContactAuthResult =
  | { ok: true; ctx: VendorContactContext }
  | { ok: false; failure: VendraAuthFailure };

/** Resolve the calling VENDOR CONTACT's context via their own linkage. */
export async function requireVendorContact(): Promise<VendorContactAuthResult> {
  const user = await getSessionUser(await headers());
  if (!user) return { ok: false, failure: { kind: "unauthorized" } };
  if (user.role !== VENDOR_CONTACT_ROLE || !user.vendorId || !user.organizationId) {
    return {
      ok: false,
      failure: { kind: "not_found", message: "Proveedor no encontrado" },
    };
  }
  const db = getDb();
  const [row] = await db
    .select({ vendor, organization, profile: vendorRequirementProfile })
    .from(vendor)
    .innerJoin(organization, eq(vendor.organizationId, organization.id))
    .innerJoin(
      vendorRequirementProfile,
      eq(vendor.requirementProfileId, vendorRequirementProfile.id),
    )
    .where(eq(vendor.id, user.vendorId))
    .limit(1);
  if (!row || row.vendor.organizationId !== user.organizationId) {
    return {
      ok: false,
      failure: { kind: "not_found", message: "Proveedor no encontrado" },
    };
  }
  return {
    ok: true,
    ctx: {
      user,
      organization: row.organization,
      vendor: row.vendor,
      profile: row.profile,
    },
  };
}

export interface ComplianceOfficerContext {
  user: SessionUser;
  organization: typeof organization.$inferSelect;
}

export type ComplianceOfficerAuthResult =
  | { ok: true; ctx: ComplianceOfficerContext }
  | { ok: false; failure: VendraAuthFailure };

/**
 * Resolve a COMPLIANCE_OFFICER/ADMIN caller. A non-officer is a 404
 * (indistinguishable from missing), never a role hint.
 */
export async function requireComplianceOfficer(): Promise<ComplianceOfficerAuthResult> {
  const user = await getSessionUser(await headers());
  if (!user) return { ok: false, failure: { kind: "unauthorized" } };
  if (!OFFICER_ROLES.has(user.role) || !user.organizationId) {
    return { ok: false, failure: { kind: "not_found", message: "No encontrado" } };
  }
  const [org] = await getDb()
    .select()
    .from(organization)
    .where(eq(organization.id, user.organizationId))
    .limit(1);
  if (!org) {
    return { ok: false, failure: { kind: "not_found", message: "No encontrado" } };
  }
  return { ok: true, ctx: { user, organization: org } };
}

export type OwnedDocumentAuthResult =
  | { ok: true; run: DocumentRunContext; user: SessionUser }
  | { ok: false; failure: VendraAuthFailure };

/**
 * Resolve a document run context AND verify the caller owns it: the
 * document's vendor must be the session user's vendor. Used by the
 * per-document routes (/process, /confirmation, DELETE), which carry no slug.
 */
export async function requireOwnedDocument(
  documentUuid: string,
): Promise<OwnedDocumentAuthResult> {
  const user = await getSessionUser(await headers());
  if (!user) return { ok: false, failure: { kind: "unauthorized" } };
  const run = await getDocumentRunContext(documentUuid);
  if (!run) {
    return {
      ok: false,
      failure: { kind: "not_found", message: "Documento no encontrado" },
    };
  }
  if (user.role === VENDOR_CONTACT_ROLE) {
    if (run.vendor.id !== user.vendorId) {
      // Not the caller's document — indistinguishable from missing.
      return {
        ok: false,
        failure: { kind: "not_found", message: "Documento no encontrado" },
      };
    }
    return { ok: true, run, user };
  }
  // Officers may act on documents inside their own org only.
  if (OFFICER_ROLES.has(user.role) && run.vendor.organizationId === user.organizationId) {
    return { ok: true, run, user };
  }
  return {
    ok: false,
    failure: { kind: "not_found", message: "Documento no encontrado" },
  };
}
