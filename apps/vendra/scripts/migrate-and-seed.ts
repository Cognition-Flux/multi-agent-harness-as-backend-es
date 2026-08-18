/**
 * The compose `migrate` service entrypoint (SPEC §9.5): apply committed
 * migrations (db-vendor owns HOW to migrate), then the idempotent demo seed
 * (the app owns the seed — it needs the better-auth instance).
 */
import { runMigrations } from "@vendra/db-vendor/migrate";

import { seedDemo } from "../src/server/seed-demo";

async function main() {
  await runMigrations();
  if (process.env.VENDOR_SEED_ON_BOOT === "true") {
    await seedDemo();
  }
}

main().catch((err) => {
  console.error("[vendra:migrate-and-seed] failed:", err);
  process.exit(1);
});
