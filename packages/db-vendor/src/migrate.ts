/**
 * Programmatic migration apply (SPEC §9.5) — the documented drizzle-orm
 * migrator, never the CLI, and never `generate`/`push`: generation happens in
 * dev, the trio is committed, and hashes are verified at apply time.
 *
 * db-vendor owns HOW to migrate; the app owns the demo seed (the seed needs
 * the app's better-auth instance — a package must never import app code).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import { assertSafeDatabaseTarget } from "./client";

export async function runMigrations(): Promise<void> {
  const url = process.env.VENDOR_DATABASE_URL;
  if (!url) {
    throw new Error("VENDOR_DATABASE_URL is not set");
  }
  assertSafeDatabaseTarget(url);
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      migrationsTable: "vendor_migrations",
    });
    console.log("[vendra:migrate] migrations applied");
  } finally {
    await pool.end();
  }
}
