import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // One container = one server.js (SPEC §9.3). outputFileTracingRoot at
  // the repo root is required for correct standalone tracing in a pnpm
  // monorepo.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@vendra/workflow", "@vendra/db-vendor"],
  // The governance admissibility gate reads a committed Wasm artifact at
  // runtime (SPEC §19.5). Nothing imports it, so tracing cannot infer it —
  // without this the standalone image would 404 on activation.
  outputFileTracingIncludes: {
    "/api/**": ["../../policy/company-policy.wasm"],
    "/(officer)/**": ["../../policy/company-policy.wasm"],
    "/(superadmin)/**": ["../../policy/company-policy.wasm"],
  },
  serverExternalPackages: [
    "pg",
    // The Claude Code harness family opens sockets, spawns processes, and
    // loads its sandbox bridge via dynamic file URLs at runtime — keep these
    // out of the server bundle and resolve them from node_modules (webpack
    // otherwise fails on the dynamic '../bridge/' import). §9.3 — without
    // this line the build itself fails.
    "@ai-sdk/harness",
    "@ai-sdk/harness-claude-code",
    "@ai-sdk/sandbox-vercel",
    "@vercel/sandbox",
    "ws",
    // mem0 reaches ~40 optional peers through `loadPeer(() => import(pkg))`.
    // Turbopack resolves those dynamic specifiers at build time and fails on
    // every provider we do not install (32 errors: bedrock, chromadb,
    // weaviate…). Keeping mem0 external leaves the imports to Node at runtime,
    // where they are guarded — and it lets better-sqlite3's native binding be
    // traced from node_modules instead of bundled (mem0 imports it STATICALLY,
    // even with `disableHistory: true`). §22.
    "mem0ai",
    "better-sqlite3",
    "@anthropic-ai/sdk",
    "@qdrant/js-client-rest",
    "ollama",
  ],
};

export default nextConfig;
