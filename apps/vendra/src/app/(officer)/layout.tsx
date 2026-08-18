import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { TrpcQueryProvider } from "@/lib/trpc-client";
import { OFFICER_ROLES, getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function OfficerLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  if (!OFFICER_ROLES.has(user.role)) redirect("/");
  return <TrpcQueryProvider>{children}</TrpcQueryProvider>;
}
