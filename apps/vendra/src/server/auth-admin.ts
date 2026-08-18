/**
 * Server-side identity assignment (registration + seed): user accounts are
 * created through the better-auth SDK (`auth.api.signUpEmail` — never raw
 * auth-table inserts), and the Vendra linkage fields (role / organizationId /
 * vendorId) are assigned HERE, server-side, because they are `input: false`
 * on the auth surface — a client can never self-assign a role or tenant.
 *
 * The linkage columns live on Vendra's own app-owned `user` table (this app
 * does not enable better-auth's cookie cache, so getSession always reads
 * fresh rows — no stale-role hazard).
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@vendra/db-vendor";

import { getAuth } from "./auth";

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: string;
  organizationId: number;
  vendorId?: number | null;
}

/** Create a user via the better-auth SDK, then assign the Vendra linkage. */
export async function createUserWithRole(
  input: CreateUserInput,
): Promise<{ userId: string }> {
  const result = await getAuth().api.signUpEmail({
    body: {
      email: input.email,
      password: input.password,
      name: input.name,
    },
  });
  const userId = result.user.id;
  await assignUserLinkage(userId, {
    role: input.role,
    organizationId: input.organizationId,
    vendorId: input.vendorId ?? null,
  });
  return { userId };
}

export async function assignUserLinkage(
  userId: string,
  linkage: { role: string; organizationId: number; vendorId: number | null },
): Promise<void> {
  await getDb()
    .update(schema.user)
    .set({
      role: linkage.role,
      organizationId: linkage.organizationId,
      vendorId: linkage.vendorId,
    })
    .where(eq(schema.user.id, userId));
}
