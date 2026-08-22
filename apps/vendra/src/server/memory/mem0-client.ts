/**
 * The mem0 boundary (SPEC §22) — the ONLY module in this repo that may import
 * `mem0ai`. Everything else talks to `recall.ts` / `ingest.ts` / `drain.ts`.
 *
 * Verified against the installed types, not the docs: `mem0ai@3.1.6`,
 * `node_modules/mem0ai/dist/oss/index.d.ts`. Three facts from that file drive
 * the code below, and each contradicts a published source:
 *
 *  1. `EmbeddingConfig` carries `baseURL` (capital URL) and `embeddingDims`.
 *     The live docs show `{ model, apiKey, embeddingDims }` with no base URL at
 *     all — which would have made a local Ollama unusable from TypeScript — and
 *     the mem0 skill documents `baseUrl` + `dimensions`. Both are wrong here.
 *  2. `MemoryConfig` has `disableHistory` and `customInstructions`, but NO
 *     `telemetry` field. Telemetry is env-only (see below).
 *  3. `embedder`, `vectorStore` and `llm` are all REQUIRED, so there is no path
 *     by which an unset key silently falls back to OpenAI.
 *  4. The Qdrant store reads `config.dimension` (default 1536) and ignores
 *     `embeddingModelDims`; and it now creates its own payload indexes on
 *     `user_id`/`agent_id`/`run_id`/`actor_id`, so we must not create camelCase
 *     ones. The mem0 skill says otherwise — it documents 3.0.3.
 *
 * The scoping asymmetry is real and easy to get wrong: `add()` takes camelCase
 * `userId`/`runId` (via `Entity`), while `search()` scopes through
 * `filters: { user_id, run_id }` in snake_case and calls its limit `topK`.
 *
 * ## Telemetry (CLAUDE.md rule 1)
 *
 * mem0 3.1.6 POSTs to `us.i.posthog.com`. The switch is a module-scope constant
 * read once at import:
 *
 *     var MEM0_TELEMETRY = process.env.MEM0_TELEMETRY?.toLowerCase() === "false" ? false : true;
 *
 * It defaults to ON, there is no config field, and `POSTHOG_DISABLED` (which
 * the mem0 skill suggests) does nothing in this version. So the env var must be
 * set BEFORE the module is evaluated — which is why mem0 is loaded through a
 * dynamic `import()` inside the lazy singleton rather than a static import.
 * Static imports are hoisted, and a hoisted mem0 would read the env before any
 * of our code could set it.
 */
import type { Memory as Mem0Memory } from "mem0ai/oss";

import { vendraError, vendraLog } from "@/server/harness/log";

import {
  EMBEDDING_DIMENSIONS,
  MEMORY_COLLECTION,
  MEMORY_CUSTOM_INSTRUCTIONS,
  memoryConfig,
  memoryConfigGap,
} from "./config";

/** Scope handed to every mem0 call. `userId` is the tenant boundary. */
export interface MemoryScope {
  /** The vendor uuid — mem0 `userId`. Never an internal integer id. */
  userId: string;
  /** The assistant thread — mem0 `runId`. Optional: facts outlive threads. */
  runId?: string;
}

const globalStore = globalThis as typeof globalThis & {
  __vendraMem0?: { client: Promise<Mem0Memory | null> | null };
};

const store = globalStore.__vendraMem0 ?? (globalStore.__vendraMem0 = { client: null });

/**
 * The lazily-built singleton, or null when the layer is unconfigured or the
 * SDK fails to load. Never throws — memory is an enhancement, and the chat has
 * to work without it.
 *
 * **Failures are not cached.** Caching a null would turn any transient
 * condition at first use — env not yet loaded, Qdrant still starting, a
 * network blip — into a permanent outage that only a restart clears. Observed
 * exactly that: the drain's first tick ran before the env file was read, and
 * the layer stayed dead afterwards while /api/health cheerfully reported `ok`
 * (health probes the config fresh, so the two disagreed). Only a built client
 * is memoised; a null clears the slot so the next caller retries.
 */
export function getMemoryClient(): Promise<Mem0Memory | null> {
  store.client ??= buildClient().then((client) => {
    if (!client) store.client = null;
    return client;
  });
  return store.client;
}

async function buildClient(): Promise<Mem0Memory | null> {
  const config = memoryConfig();
  if (!config) {
    vendraLog("memory.unconfigured", { missing: memoryConfigGap() });
    return null;
  }

  // Rule 1: no telemetry sink. Set before the dynamic import below, which is
  // when mem0's module-scope constant is evaluated.
  process.env.MEM0_TELEMETRY = "false";

  try {
    const { Memory } = await import("mem0ai/oss");
    const client = new Memory({
      embedder: {
        provider: "ollama",
        config: {
          model: config.embedModel,
          baseURL: config.ollamaUrl,
          embeddingDims: EMBEDDING_DIMENSIONS,
        },
      },
      vectorStore: {
        provider: "qdrant",
        config: {
          collectionName: MEMORY_COLLECTION,
          // VERIFIED against the bundle: the Qdrant store reads
          // `config.dimension` and DEFAULTS TO 1536. It ignores
          // `embeddingModelDims`, which is the key most mem0 material shows.
          // Setting only that one would create a 1536-d collection for a
          // 1024-d model and fail every insert. Same literal as the embedder.
          dimension: EMBEDDING_DIMENSIONS,
          url: config.qdrantUrl,
        },
      },
      llm: {
        provider: "anthropic",
        config: {
          model: config.extractionModel,
          apiKey: config.anthropicApiKey,
          // MUST be set explicitly. mem0 3.1.6 merges the user's llm config
          // over `DEFAULT_MEMORY_CONFIG.llm.config`, whose `baseURL` is
          // "https://api.openai.com/v1" — and `AnthropicLLM` forwards whatever
          // `baseURL` it receives to the SDK. Omitting it therefore points the
          // Anthropic client at OpenAI and every extraction 404s. Diagnosed
          // from the response headers (Domain=api.openai.com), because the
          // error itself is a bare "404 status code (no body)".
          baseURL: "https://api.anthropic.com",
          temperature: 0,
          maxTokens: 2_048,
        },
      },
      // mem0's own history is SQLite — a native single-writer file we do not
      // want in a container. Our audit trail is `assistant_memory` in Postgres
      // (rule 7), which is also the system of record.
      disableHistory: true,
      customInstructions: MEMORY_CUSTOM_INSTRUCTIONS,
    });
    vendraLog("memory.client_ready", {
      embedModel: config.embedModel,
      extractionModel: config.extractionModel,
      dims: EMBEDDING_DIMENSIONS,
      collection: MEMORY_COLLECTION,
    });
    return client;
  } catch (err) {
    vendraError("memory.client_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Probe the two containers the layer depends on, for /api/health.
 *
 * Deliberately does NOT construct the mem0 client: a probe must not have the
 * side effect of creating the collection, and a health check should stay cheap.
 */
export async function probeMemoryBackends(): Promise<{
  qdrant: boolean;
  ollama: boolean;
}> {
  const config = memoryConfig();
  if (!config) return { qdrant: false, ollama: false };
  const reach = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  const [qdrant, ollama] = await Promise.all([
    reach(`${config.qdrantUrl}/readyz`),
    reach(`${config.ollamaUrl}/api/version`),
  ]);
  return { qdrant, ollama };
}
