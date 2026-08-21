import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  OFFICER_ROLES,
  SUPERADMIN_ROLE,
  VENDOR_CONTACT_ROLE,
  getSessionUser,
} from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  if (user.role === VENDOR_CONTACT_ROLE && user.vendorId) redirect("/portal");
  if (OFFICER_ROLES.has(user.role)) redirect("/vendors");
  // SUPERADMIN is deliberately absent from OFFICER_ROLES, so it needs its own
  // branch — without it a signed-in superadmin lands back on /login forever.
  if (user.role === SUPERADMIN_ROLE) redirect("/platform");
  redirect("/login");
}
