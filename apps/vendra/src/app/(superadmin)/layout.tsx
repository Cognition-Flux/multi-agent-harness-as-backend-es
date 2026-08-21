import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { TrpcQueryProvider } from "@/lib/trpc-client";
import { SUPERADMIN_ROLE, getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * The platform console (SPEC §19.5). Mirrors the officer layout, but guards on
 * SUPERADMIN alone — `OFFICER_ROLES` deliberately excludes it, so a superadmin
 * has no vendor-adjudication surface and an officer has no platform surface.
 */
export default async function SuperadminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  if (user.role !== SUPERADMIN_ROLE) redirect("/");
  return <TrpcQueryProvider>{children}</TrpcQueryProvider>;
}
