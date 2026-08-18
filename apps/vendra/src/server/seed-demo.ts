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

import { COMPLIANCE_OFFICER_ROLE, VENDOR_CONTACT_ROLE } from "./auth";
import { createUserWithRole } from "./auth-admin";

const DEMO_ORG_SLUG = "acme-construction";

export const DEMO_CREDENTIALS = {
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

  // The two v1 requirement-profile presets — profiles are DATA per org (R5).
  const [constructionSub] = await db
    .insert(schema.vendorRequirementProfile)
    .values({
      organizationId: org.id,
      name: "construction-sub",
      required: [
        RequirementCategory.TAX_IDENTITY,
        RequirementCategory.INSURANCE_GENERAL_LIABILITY,
        RequirementCategory.INSURANCE_WORKERS_COMP,
        RequirementCategory.INSURANCE_AUTO,
        RequirementCategory.BUSINESS_LICENSE,
        RequirementCategory.SAFETY_RECORD,
        RequirementCategory.BANKING_VERIFICATION,
        RequirementCategory.SIGNED_AGREEMENTS,
        RequirementCategory.DIVERSITY_CERTIFICATION,
      ],
      mandatory: [
        RequirementCategory.TAX_IDENTITY,
        RequirementCategory.INSURANCE_GENERAL_LIABILITY,
      ],
      dismissible: [
        RequirementCategory.DIVERSITY_CERTIFICATION,
        RequirementCategory.INSURANCE_AUTO,
        RequirementCategory.INSURANCE_WORKERS_COMP,
        RequirementCategory.SAFETY_RECORD,
      ],
      maxManualDismissable: 2,
      thresholds: {
        gl_occurrence_usd: 1_000_000,
        gl_aggregate_usd: 2_000_000,
        auto_limit_usd: 1_000_000,
        wc_limit_usd: 500_000,
        emr_max: 1.0,
        soc2_max_age_months: 12,
        require_additional_insured: true,
      },
    })
    .returning();
  await db.insert(schema.vendorRequirementProfile).values({
    organizationId: org.id,
    name: "general-supplier",
    required: [
      RequirementCategory.TAX_IDENTITY,
      RequirementCategory.BANKING_VERIFICATION,
      RequirementCategory.SIGNED_AGREEMENTS,
      RequirementCategory.INSURANCE_GENERAL_LIABILITY,
      RequirementCategory.DATA_SECURITY,
    ],
    mandatory: [RequirementCategory.TAX_IDENTITY],
    dismissible: [RequirementCategory.DATA_SECURITY],
    maxManualDismissable: 1,
    thresholds: {
      gl_occurrence_usd: 1_000_000,
      gl_aggregate_usd: 2_000_000,
      require_additional_insured: false,
    },
  });
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

  vendraLog("seed.done", { org: org.id, vendor: vendorRow.id });
  console.log("");
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  Vendra demo seeded — log in at http://localhost:3000       │");
  console.log("│                                                             │");
  console.log(`│  Compliance officer:  ${DEMO_CREDENTIALS.officer.email}          │`);
  console.log(`│                       ${DEMO_CREDENTIALS.officer.password}                      │`);
  console.log(`│  Vendor contact:      ${DEMO_CREDENTIALS.vendor.email}           │`);
  console.log(`│                       ${DEMO_CREDENTIALS.vendor.password}                       │`);
  console.log("└─────────────────────────────────────────────────────────────┘");
  console.log("");
}
