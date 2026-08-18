import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OFFICER_ROLES, VENDOR_CONTACT_ROLE, getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  if (user.role === VENDOR_CONTACT_ROLE && user.vendorId) redirect("/portal");
  if (OFFICER_ROLES.has(user.role)) redirect("/vendors");
  redirect("/login");
}
