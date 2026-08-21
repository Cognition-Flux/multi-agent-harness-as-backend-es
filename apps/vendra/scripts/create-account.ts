/**
 * Local account spawner (SPEC §17 C10) — the scriptable path for minting NEW
 * officer or vendor-contact logins on demand (E2E rounds, demos). Fully
 * offline: accounts are created through the app's own better-auth instance
 * (in-process `auth.api.signUpEmail`, node:crypto scrypt hashing — never raw
 * auth-table writes) and linked via drizzle, exactly like registration/seed.
 *
 * Usage (cwd must be apps/vendra so tsx resolves the `@/` alias; the pnpm
 * script handles that and loads .env.local):
 *
 *   pnpm --filter vendra create-account -- --role officer \
 *     --email officer2@acme-demo.test --password 'Officer2Demo123!' \
 *     --name "Second Officer"
 *
 *   pnpm --filter vendra create-account -- --role superadmin \
 *     --email super2@vendra.test --password 'Super2Demo123!' --name "Platform Op"
 *
 *   pnpm --filter vendra create-account -- --role vendor \
 *     --email vendor@maple-e2e.test --password 'MapleE2E123!' \
 *     --name "Robin Vale" --legal-name "Maple Works LLC"
 *
 * Optional: --org <slug> (default acme-construction), --profile <name>
 * (vendor role; default = the org's first profile, matching /register).
 * Prints one JSON line: { userId, role, email, vendorId?, vendorUuid? }.
 */
import { parseArgs } from "node:util";

import { asc, eq } from "drizzle-orm";

import { getDb, getPool, schema } from "@vendra/db-vendor";

import {
  COMPLIANCE_OFFICER_ROLE,
  SUPERADMIN_ROLE,
  VENDOR_CONTACT_ROLE,
} from "../src/server/auth";
import { createUserWithRole } from "../src/server/auth-admin";
import { activeCompanyPolicyId } from "../src/server/company-policy";
import { ensurePlatformOrganization } from "../src/server/company-provisioning";
import { insertActivity } from "../src/server/harness/db/documents";

function fail(message: string): never {
  console.error(`[vendra:create-account] ${message}`);
  process.exit(1);
}

async function main() {
  // pnpm forwards its "--" separator into argv; parseArgs would demote
  // everything after it to positionals — strip the first bare "--".
  const rawArgs = process.argv.slice(2);
  const dashIdx = rawArgs.indexOf("--");
  const args =
    dashIdx === -1
      ? rawArgs
      : [...rawArgs.slice(0, dashIdx), ...rawArgs.slice(dashIdx + 1)];

  const { values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      role: { type: "string" },
      email: { type: "string" },
      password: { type: "string" },
      name: { type: "string" },
      org: { type: "string", default: "acme-construction" },
      "legal-name": { type: "string" },
      profile: { type: "string" },
    },
  });

  const role = values.role;
  if (role !== "officer" && role !== "vendor" && role !== "superadmin") {
    fail('--role must be "officer", "vendor", or "superadmin"');
  }
  if (!values.email || !values.password || !values.name) {
    fail("--email, --password, and --name are required");
  }
  if (values.password.length < 8 || values.password.length > 128) {
    fail("--password must be 8–128 characters (better-auth policy)");
  }
  if (role === "vendor" && !values["legal-name"]) {
    fail('--legal-name is required for --role vendor (names the vendor row)');
  }

  const db = getDb();

  // A superadmin belongs to the PLATFORM organization, not a tenant (SPEC
  // §19.5), so it needs no --org and the row is created on demand. This is the
  // scripted path the e2e rounds use to mint a fresh platform operator.
  if (role === "superadmin") {
    const platform = await ensurePlatformOrganization();
    const { userId } = await createUserWithRole({
      email: values.email!,
      password: values.password!,
      name: values.name!,
      role: SUPERADMIN_ROLE,
      organizationId: platform.id,
    });
    console.log(
      JSON.stringify({ userId, role: SUPERADMIN_ROLE, email: values.email }),
    );
    return;
  }

  const [org] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.slug, values.org!))
    .limit(1);
  if (!org) fail(`unknown organization slug "${values.org}" — run the seed first`);

  if (role === "officer") {
    const { userId } = await createUserWithRole({
      email: values.email,
      password: values.password,
      name: values.name,
      role: COMPLIANCE_OFFICER_ROLE,
      organizationId: org.id,
    });
    console.log(
      JSON.stringify({ userId, role: COMPLIANCE_OFFICER_ROLE, email: values.email }),
    );
    return;
  }

  // Vendor role: resolve the requirement profile (named, or the org's first
  // — the same default /api/vendor/register uses), create + link the vendor.
  const profileWhere = values.profile
    ? eq(schema.vendorRequirementProfile.name, values.profile)
    : eq(schema.vendorRequirementProfile.organizationId, org.id);
  const [profile] = await db
    .select()
    .from(schema.vendorRequirementProfile)
    .where(profileWhere)
    .orderBy(asc(schema.vendorRequirementProfile.id))
    .limit(1);
  if (!profile || profile.organizationId !== org.id) {
    fail(
      values.profile
        ? `profile "${values.profile}" not found in org "${values.org}"`
        : `org "${values.org}" has no requirement profile — run the seed first`,
    );
  }

  const [vendorRow] = await db
    .insert(schema.vendor)
    .values({
      organizationId: org.id,
      legalName: values["legal-name"]!,
      contactEmail: values.email,
      requirementProfileId: profile.id,
      // Same pin as /api/vendor/register (§19.3) — a seeded vendor must be
      // governed exactly like a registered one.
      companyPolicyId: await activeCompanyPolicyId(org.id),
    })
    .returning();
  if (!vendorRow) fail("vendor insert returned no row");

  try {
    const { userId } = await createUserWithRole({
      email: values.email,
      password: values.password,
      name: values.name,
      role: VENDOR_CONTACT_ROLE,
      organizationId: org.id,
      vendorId: vendorRow.id,
    });
    await insertActivity({
      vendorId: vendorRow.id,
      organizationId: org.id,
      type: "VENDOR_REGISTERED",
      metadata: { legalName: vendorRow.legalName, source: "create-account" },
    });
    console.log(
      JSON.stringify({
        userId,
        role: VENDOR_CONTACT_ROLE,
        email: values.email,
        vendorId: vendorRow.id,
        vendorUuid: vendorRow.uuid,
      }),
    );
  } catch (err) {
    // Compensating rollback, same contract as /register (spec §16 B10).
    await db
      .delete(schema.vendor)
      .where(eq(schema.vendor.id, vendorRow.id))
      .catch(() => undefined);
    throw err;
  }
}

main()
  .catch((err) => {
    console.error("[vendra:create-account] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => void getPool().end());
