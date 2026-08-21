/**
 * App-local better-auth instance (SPEC §6.11) — email+password only, no
 * SSO/org plugins; the tenant lives in Vendra's own `organization` table and
 * rides the user row as additionalFields.
 *
 * `input: false` on every additional field: role/tenant/vendor linkage is
 * NEVER client-settable — it is assigned server-side at registration/seed
 * time (see auth-admin.ts).
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { getDb, schema } from "@vendra/db-vendor";

import { env } from "@/env";

export const VENDOR_CONTACT_ROLE = "VENDOR_CONTACT";
export const COMPLIANCE_OFFICER_ROLE = "COMPLIANCE_OFFICER";
export const ADMIN_ROLE = "ADMIN";
/** Platform operator: onboards companies (SPEC §19.5). Cross-tenant BY DESIGN. */
export const SUPERADMIN_ROLE = "SUPERADMIN";

/**
 * Roles that act INSIDE one organization. Every officer surface org-scopes its
 * reads against the caller's `organizationId`, so membership here means
 * "trusted within a tenant".
 *
 * SUPERADMIN is deliberately NOT a member. It is not a bigger officer — it is a
 * different axis (it operates ACROSS tenants and never adjudicates a vendor), and
 * adding it here would silently grant officer powers inside every company at
 * once. `requireSuperadmin` is its own guard.
 */
export const OFFICER_ROLES = new Set([COMPLIANCE_OFFICER_ROLE, ADMIN_ROLE]);

/**
 * The organization a superadmin's user row points at. `user.organization_id` is
 * NOT NULL and every existing guard reads it, so rather than widening the column
 * (and every falsy check that depends on it) a superadmin belongs to a real,
 * seeded platform row that owns no vendors and no requirement profiles.
 */
export const PLATFORM_ORG_SLUG = "vendra-platform";

function createAuth() {
  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    emailAndPassword: { enabled: true },
    // Sign-in brute-force throttle in EVERY run mode (SPEC §17 C9) — the
    // library default is production-only. Memory storage: single-container
    // app, no external store, offline-clean.
    rateLimit: { enabled: true },
    // Registration flows through /api/vendor/register (role/tenant linkage
    // is server-assigned there). Router-level disable only: the
    // server-internal auth.api.signUpEmail used by auth-admin/seed/scripts
    // is unaffected — never use emailAndPassword.disableSignUp instead.
    disabledPaths: ["/sign-up/email"],
    // Belt-and-suspenders for rule 1: 1.6.5 defaults telemetry off and
    // ships no endpoint, but the pin makes the guarantee explicit.
    telemetry: { enabled: false },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: VENDOR_CONTACT_ROLE,
          input: false,
        },
        organizationId: { type: "number", required: false, input: false },
        vendorId: { type: "number", required: false, input: false },
      },
    },
  });
}

const globalStore = globalThis as typeof globalThis & {
  __vendorAuth?: ReturnType<typeof createAuth>;
};

export function getAuth() {
  return (globalStore.__vendorAuth ??= createAuth());
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: number | null;
  vendorId: number | null;
}

/** Read the calling session's user, with the Vendra additional fields typed. */
export async function getSessionUser(
  headers: Headers,
): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers });
  if (!session?.user) return null;
  const user = session.user as unknown as {
    id: string;
    email: string;
    name: string;
    role?: string | null;
    organizationId?: number | null;
    vendorId?: number | null;
  };
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role ?? VENDOR_CONTACT_ROLE,
    organizationId: user.organizationId ?? null,
    vendorId: user.vendorId ?? null,
  };
}
