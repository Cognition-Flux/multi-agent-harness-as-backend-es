/**
 * App-local tRPC (SPEC §8) — `complianceAdminProcedure` is the
 * caseManagementAdminProcedure analog: role-gated server-side, org-scoped,
 * the slug never a permission input. A non-officer caller gets NOT_FOUND
 * (indistinguishable from missing).
 */
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";

import {
  OFFICER_ROLES,
  SUPERADMIN_ROLE,
  getSessionUser,
  type SessionUser,
} from "@/server/auth";
import { AdmissionRefusedError } from "@/server/policy-admission";

export interface TrpcContext {
  user: SessionUser | null;
}

export async function createTrpcContext(opts: {
  headers: Headers;
}): Promise<TrpcContext> {
  const user = await getSessionUser(opts.headers);
  return { user };
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // Gate refusals travel STRUCTURALLY (SPEC §23.9): an AdmissionRefusedError
  // cause becomes `error.data.admission`, so the console never re-parses
  // findings out of a message string.
  errorFormatter({ shape, error }) {
    if (error.cause instanceof AdmissionRefusedError) {
      return {
        ...shape,
        data: {
          ...shape.data,
          admission: {
            violations: error.cause.violations,
            warnings: error.cause.warnings,
          },
        },
      };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * The PLATFORM operator (SPEC §19.5). Deliberately not built on
 * `complianceAdminProcedure`: this is the one procedure family that does NOT
 * inject an organization scope, because onboarding companies is cross-tenant.
 * Every procedure using it must therefore resolve its target organization from
 * an explicit uuid — there is no ambient tenant to fall back on.
 *
 * A non-superadmin gets NOT_FOUND, never a role hint, and an officer is NOT a
 * superadmin (SUPERADMIN_ROLE is not in OFFICER_ROLES).
 */
export const superadminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (ctx.user.role !== SUPERADMIN_ROLE) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return next({ ctx: { user: ctx.user } });
});

export const complianceAdminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!OFFICER_ROLES.has(ctx.user.role) || !ctx.user.organizationId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return next({
    ctx: {
      user: ctx.user,
      organizationId: ctx.user.organizationId,
    },
  });
});
