import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { VendorPortal } from "@/features/vendor-compliance/components/vendor-portal";
import { env } from "@/env";
import { VENDOR_CONTACT_ROLE, getSessionUser } from "@/server/auth";
import { buildComplianceSummary } from "@/server/compliance-summary";
import { loadDocumentsSnapshot } from "@/server/harness/db/page-load";
import { runJanitor } from "@/server/harness/janitor";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  if (user.role !== VENDOR_CONTACT_ROLE || !user.vendorId) redirect("/");

  await runJanitor(user.vendorId);
  const [summary, documents] = await Promise.all([
    buildComplianceSummary(user.vendorId),
    loadDocumentsSnapshot(user.vendorId),
  ]);

  return (
    <VendorPortal
      initialSummary={summary}
      initialDocuments={documents}
      verbose={env.VENDOR_AGENT_VERBOSITY === "high"}
    />
  );
}
