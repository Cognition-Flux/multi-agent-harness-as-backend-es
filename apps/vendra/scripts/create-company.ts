/**
 * Local company provisioner (SPEC §19.5) — the scriptable twin of the
 * superadmin console's "Nueva empresa" flow, so a full tenant can be created
 * offline for E2E rounds without driving a browser.
 *
 * It calls the SAME `provisionCompany` the console calls: organization +
 * requirement profile + an admissible v1 policy + the company's first officer,
 * with the §16 B10 compensating rollback if the account fails.
 *
 *   pnpm --filter vendra create-company -- \
 *     --name "Northwind Utilities LLC" --slug northwind-utilities \
 *     --preset construction-sub \
 *     --officer-email officer@northwind.test \
 *     --officer-password 'NorthwindOps123!' --officer-name "Nora Officer"
 *
 * --preset defaults to construction-sub; omit the officer flags to provision the
 * tenant only. Prints one JSON line.
 */
import { parseArgs } from "node:util";

import { getPool } from "@vendra/db-vendor";

import {
  ProvisioningError,
  provisionCompany,
} from "../src/server/company-provisioning";
import { REQUIREMENT_PRESETS } from "../src/server/requirement-presets";

function fail(message: string): never {
  console.error(`[vendra:create-company] ${message}`);
  process.exit(1);
}

async function main() {
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
      name: { type: "string" },
      slug: { type: "string" },
      preset: { type: "string", default: "construction-sub" },
      "officer-email": { type: "string" },
      "officer-password": { type: "string" },
      "officer-name": { type: "string" },
    },
  });

  if (!values.name || !values.slug) fail("--name and --slug are required");
  if (!REQUIREMENT_PRESETS.some((p) => p.id === values.preset)) {
    fail(
      `unknown --preset "${values.preset}" (have: ${REQUIREMENT_PRESETS.map((p) => p.id).join(", ")})`,
    );
  }
  const wantsOfficer =
    values["officer-email"] || values["officer-password"] || values["officer-name"];
  if (
    wantsOfficer &&
    !(values["officer-email"] && values["officer-password"] && values["officer-name"])
  ) {
    fail("--officer-email, --officer-password and --officer-name go together");
  }

  try {
    const result = await provisionCompany({
      name: values.name,
      slug: values.slug,
      presetId: values.preset!,
      ...(wantsOfficer
        ? {
            officer: {
              email: values["officer-email"]!,
              password: values["officer-password"]!,
              name: values["officer-name"]!,
            },
          }
        : {}),
    });
    console.log(JSON.stringify(result));
  } catch (err) {
    if (err instanceof ProvisioningError) fail(`${err.code}: ${err.message}`);
    throw err;
  }
}

main()
  .catch((err) => {
    console.error("[vendra:create-company] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => void getPool().end());
