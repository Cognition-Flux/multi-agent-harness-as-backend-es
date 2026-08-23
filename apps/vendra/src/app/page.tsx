import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LandingPage } from "@/features/landing/landing-page";
import {
  OFFICER_ROLES,
  SUPERADMIN_ROLE,
  VENDOR_CONTACT_ROLE,
  getSessionUser,
} from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser(await headers());
  if (user) {
    if (user.role === VENDOR_CONTACT_ROLE && user.vendorId) redirect("/portal");
    if (OFFICER_ROLES.has(user.role)) redirect("/vendors");
    // SUPERADMIN is deliberately absent from OFFICER_ROLES, so it needs its
    // own branch — without it a signed-in superadmin would land on the
    // public landing page forever.
    if (user.role === SUPERADMIN_ROLE) redirect("/platform");
  }
  // Signed-out visitors (and accounts with no destination) get the public
  // landing page, which funnels into /login and /register. The year is
  // computed here so SSR and hydration render the same copyright line.
  return <LandingPage year={new Date().getFullYear()} />;
}
