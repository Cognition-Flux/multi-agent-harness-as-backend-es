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

/**
 * Run `fn` under a Postgres session advisory lock held on ONE PINNED
 * connection, or skip (return null) when another holder has it.
 *
 * The pinning is the whole point. `pg_try_advisory_lock` over the pool's
 * `query()` acquires the lock on whichever connection happens to be idle; the
 * matching unlock later runs on whichever connection happens to be idle THEN.
 * When they differ — guaranteed eventually under concurrent traffic, because
 * the awaits between them return the connection to the pool — the unlock is a
 * silent no-op (`pg_advisory_unlock` returns false, nobody checks), the lock
 * stays glued to a connection now serving unrelated queries, and every future
 * try-lock in every process returns false: the scheduled job stops fleet-wide
 * with nothing in the logs. Found by an adversarial audit of the §22 drain;
 * the sweep had the identical latent bug.
 *
 * Session-level (not xact) so the lock spans `fn`'s own transactions; acquire,
 * `fn`, and unlock all live and die on the same checked-out client.
 */
export async function withAdvisoryLock<T>(
  key: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  const client = await getPool().connect();
  let locked = false;
  try {
    const res = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [key],
    );
    locked = res.rows[0]?.locked === true;
    if (!locked) return { ran: false };
    const result = await fn();
    return { ran: true, result };
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [key]);
    } finally {
      client.release();
    }
  }
}
