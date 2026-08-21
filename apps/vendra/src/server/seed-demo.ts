/**
 * Demo seed (SPEC §9.5) — idempotent: no-ops when the demo org exists.
 * Creates one demo org, the two v1 requirement-profile presets, one
 * compliance-officer login, and one vendor-contact login (+ its vendor row).
 * Users are created through the app's own better-auth instance (auth.api
 * works headless — no HTTP server required; never raw auth-table writes).
 *
 * Credentials print to the compose log ONCE — local demo creds, not secrets.
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";
import { RequirementCategory, vendraLog } from "@vendra/workflow/vendor";

import { COMPLIANCE_OFFICER_ROLE, SUPERADMIN_ROLE, VENDOR_CONTACT_ROLE } from "./auth";
import { createUserWithRole } from "./auth-admin";
import { ensurePlatformOrganization } from "./company-provisioning";
import { REQUIREMENT_PRESETS } from "./requirement-presets";

const DEMO_ORG_SLUG = "acme-construction";

export const DEMO_CREDENTIALS = {
  superadmin: { email: "superadmin@vendra.test", password: "SuperDemo123!" },
  officer: { email: "officer@acme-demo.test", password: "OfficerDemo123!" },
  vendor: { email: "vendor@summit-demo.test", password: "VendorDemo123!" },
} as const;

export async function seedDemo(): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.slug, DEMO_ORG_SLUG))
    .limit(1);
  if (existing) {
    console.log("[vendra:seed] demo org already present — skipping");
    return;
  }

  const [org] = await db
    .insert(schema.organization)
    .values({ name: "Acme Construction Group", slug: DEMO_ORG_SLUG })
    .returning();
  if (!org) throw new Error("seed: organization insert returned no row");

  // The two v1 requirement-profile presets — profiles are DATA per org (R5),
  // and the SAME definitions the superadmin console provisions from, so a
  // console-created company and the demo org can never drift apart.
  const inserted = await db
    .insert(schema.vendorRequirementProfile)
    .values(
      REQUIREMENT_PRESETS.map((preset) => ({
        organizationId: org.id,
        name: preset.name,
        required: preset.required,
        mandatory: preset.mandatory,
        dismissible: preset.dismissible,
        maxManualDismissable: preset.maxManualDismissable,
        thresholds: preset.thresholds,
      })),
    )
    .returning();
  const constructionSub = inserted.find((row) => row.name === "construction-sub");
  if (!constructionSub) throw new Error("seed: profile insert returned no row");

  // The seeded compliance officer.
  await createUserWithRole({
    email: DEMO_CREDENTIALS.officer.email,
    password: DEMO_CREDENTIALS.officer.password,
    name: "Dana Officer",
    role: COMPLIANCE_OFFICER_ROLE,
    organizationId: org.id,
  });

  // The seeded vendor contact + its vendor row.
  const [vendorRow] = await db
    .insert(schema.vendor)
    .values({
      organizationId: org.id,
      legalName: "Summit Electrical Contractors LLC",
      contactEmail: DEMO_CREDENTIALS.vendor.email,
      requirementProfileId: constructionSub.id,
    })
    .returning();
  if (!vendorRow) throw new Error("seed: vendor insert returned no row");
  await createUserWithRole({
    email: DEMO_CREDENTIALS.vendor.email,
    password: DEMO_CREDENTIALS.vendor.password,
    name: "Sam Vendor",
    role: VENDOR_CONTACT_ROLE,
    organizationId: org.id,
    vendorId: vendorRow.id,
  });

  // The platform superadmin (SPEC §19.5). Its own organization row, so the
  // NOT NULL user.organization_id FK holds without weakening it for anyone else.
  const platform = await ensurePlatformOrganization();
  await createUserWithRole({
    email: DEMO_CREDENTIALS.superadmin.email,
    password: DEMO_CREDENTIALS.superadmin.password,
    name: "Vera Superadmin",
    role: SUPERADMIN_ROLE,
    organizationId: platform.id,
  });

  vendraLog("seed.done", { org: org.id, vendor: vendorRow.id, platform: platform.id });
  // Padded from the content rather than by hand: the previous fixed-width
  // literals drifted out of alignment the moment an email length changed.
  const rows: [string, string][] = [
    ["Superadmin", DEMO_CREDENTIALS.superadmin.email],
    ["", DEMO_CREDENTIALS.superadmin.password],
    ["Compliance officer", DEMO_CREDENTIALS.officer.email],
    ["", DEMO_CREDENTIALS.officer.password],
    ["Vendor contact", DEMO_CREDENTIALS.vendor.email],
    ["", DEMO_CREDENTIALS.vendor.password],
  ];
  const title = "Vendra demo seeded — log in at http://localhost:3000";
  const label = (name: string) => (name ? `${name}:`.padEnd(20) : " ".repeat(20));
  const lines = [title, "", ...rows.map(([n, v]) => `${label(n)} ${v}`)];
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  console.log("");
  console.log(`┌${"─".repeat(width)}┐`);
  for (const line of lines) console.log(`│  ${line.padEnd(width - 2)}│`);
  console.log(`└${"─".repeat(width)}┘`);
  console.log("");
}
