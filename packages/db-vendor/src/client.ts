/**
 * The Drizzle client for Vendra's own Postgres (SPEC §6.10).
 *
 * Connection env: VENDOR_DATABASE_URL. The pool is created lazily-safe (pg
 * connects on first query, not at construction), and a prod-looking URL is
 * refused outright — this app's DB work is local-container-only by contract.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../drizzle/schema";

export { schema };

/** Refuse URLs that look like a shared/production database (seed-guard parity). */
export function assertSafeDatabaseTarget(url: string): void {
  const lowered = url.toLowerCase();
  const forbidden = ["prod", "production", "rds.amazonaws.com"];
  for (const marker of forbidden) {
    if (lowered.includes(marker)) {
      throw new Error(
        `Refusing to touch a database whose URL contains "${marker}" — Vendra runs against its own local container only.`,
      );
    }
  }
}

const globalStore = globalThis as typeof globalThis & {
  __vendorDbPool?: Pool;
  __vendorDb?: NodePgDatabase<typeof schema>;
};

function createPool(): Pool {
  const url = process.env.VENDOR_DATABASE_URL;
  if (!url) {
    throw new Error("VENDOR_DATABASE_URL is not set");
  }
  assertSafeDatabaseTarget(url);
  return new Pool({ connectionString: url });
}

export function getPool(): Pool {
  return (globalStore.__vendorDbPool ??= createPool());
}

export function getDb(): NodePgDatabase<typeof schema> {
  return (globalStore.__vendorDb ??= drizzle(getPool(), { schema }));
}

export type VendorDb = NodePgDatabase<typeof schema>;
