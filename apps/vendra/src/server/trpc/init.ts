/**
 * App-local tRPC (SPEC §8) — `complianceAdminProcedure` is the
 * caseManagementAdminProcedure analog: role-gated server-side, org-scoped,
 * the slug never a permission input. A non-officer caller gets NOT_FOUND
 * (indistinguishable from missing).
 */
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";

import { OFFICER_ROLES, getSessionUser, type SessionUser } from "@/server/auth";

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
});

export const router = t.router;
export const publicProcedure = t.procedure;

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
