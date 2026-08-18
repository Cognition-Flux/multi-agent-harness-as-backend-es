import { getAuth } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazy per-request dispatch — the auth instance opens a DB pool, which must
// never happen at build-time module evaluation.
export async function GET(req: Request) {
  return getAuth().handler(req);
}

export async function POST(req: Request) {
  return getAuth().handler(req);
}
