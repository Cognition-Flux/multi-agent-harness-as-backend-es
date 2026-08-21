/**
 * The compose `migrate` service entrypoint (SPEC §9.5): apply committed
 * migrations (db-vendor owns HOW to migrate), then the governance backfill
 * (§19.6 — every org gets a behaviour-preserving policy), then the idempotent
 * demo seed (the app owns the seed — it needs the better-auth instance).
 */
import { runMigrations } from "@vendra/db-vendor/migrate";

import { backfillCompanyPolicies } from "../src/server/company-policy";
import { seedDemo } from "../src/server/seed-demo";

async function main() {
  await runMigrations();
  if (process.env.VENDOR_SEED_ON_BOOT === "true") {
    await seedDemo();
  }
  // AFTER the seed, not before: on a fresh database `seedDemo` creates the demo
  // organization and its profiles, and a backfill that ran first would leave that
  // org with no ACTIVE policy for its entire first boot. Idempotent either way —
  // orgs that already have one are skipped.
  await backfillCompanyPolicies();
}

main().catch((err) => {
  console.error("[vendra:migrate-and-seed] failed:", err);
  process.exit(1);
});
