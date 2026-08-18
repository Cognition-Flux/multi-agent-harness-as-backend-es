/**
 * Shared long-lived Vercel Sandbox for all document-processing sessions
 * (SPEC §6.1).
 *
 * One MicroVM is created once and wrapped via createVercelSandbox's
 * wrap-mode ({ sandbox, bridgePorts }) so concurrent Claude Code sessions
 * each get a bridge port from the pool instead of paying a fresh sandbox +
 * bridge bootstrap (1-3 min) per document.
 *
 * Constraints encoded here:
 * - Vercel sandboxes expose AT MOST 4 ports → the pool is 4 ports and the
 *   doc semaphore stays ≤ pool − 1 (the coverage lane owns a reserved slot).
 * - Sandbox lifetime is hard-capped (~45 min) → proactive recreate at 35 min
 *   when recently used, reactive recreate when session creation fails.
 * - Wrap-mode: the provider's stop/destroy are no-ops — THIS module owns the
 *   sandbox lifecycle.
 * - Egress stays deny-by-default: only the Anthropic API and the npm
 *   registry (bridge bootstrap) are reachable.
 * - The 4 harness creds are OPTIONAL at boot: `requireHarnessCredentials()`
 *   throws a clear named error only when a sandbox/session is actually
 *   requested, and `warmSharedSandbox()` logs-and-skips.
 */
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import {
  createFileReporter,
  prepareSandboxForHarness,
} from "@ai-sdk/harness/agent";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import { APIError, Sandbox, StreamError } from "@vercel/sandbox";

import { env } from "@/env";
import { Semaphore } from "@/server/semaphore";

import { type LogFields, vendraError, vendraLog, vendraWarn } from "./log";

export const SANDBOX_BRIDGE_PORTS = [4000, 4001, 4002, 4003] as const;

export const SANDBOX_EGRESS_ALLOWLIST = ["api.anthropic.com", "*.npmjs.org"];

/** Vercel's hard cap on sandbox lifetime is 45 min; renew comfortably under it. */
const SANDBOX_TIMEOUT_MS = 45 * 60 * 1000;
const MAX_SANDBOX_AGE_MS = 35 * 60 * 1000;
/** Ceiling for the one-time bridge bake on a fresh sandbox. */
const BAKE_TIMEOUT_MS = 240_000;
/** How long a proactively-replaced sandbox lingers so in-flight sessions finish. */
const RETIRE_GRACE_MS = 8 * 60 * 1000;

// ─── Harness error → structured log fields ───────────────────────────────────

function vercelErrorEnvelope(json: unknown): {
  code?: string;
  message?: string;
} {
  if (json && typeof json === "object" && "error" in json) {
    const inner = (json as { error: unknown }).error;
    if (inner && typeof inner === "object") {
      const { code, message } = inner as { code?: unknown; message?: unknown };
      return {
        code: typeof code === "string" ? code : undefined,
        message: typeof message === "string" ? message : undefined,
      };
    }
  }
  return {};
}

/**
 * Flatten any harness-path error into structured log fields — a Vercel
 * Sandbox APIError additionally carries the HTTP status and the API's own
 * code/detail (e.g. `status=402 code=payment_required`), the difference
 * between a greppable root cause and an opaque failure line.
 */
export function harnessErrorFields(err: unknown): LogFields {
  if (err instanceof APIError) {
    const envelope = vercelErrorEnvelope(err.json);
    return {
      message: err.message,
      upstream: "vercel-sandbox-api",
      status: err.response.status,
      code: envelope.code,
      detail: envelope.message,
      sandbox: err.sandboxName,
      session: err.sessionId,
    };
  }
  if (err instanceof StreamError) {
    return {
      message: err.message,
      upstream: "vercel-sandbox-stream",
      code: err.code,
      session: err.sessionId,
    };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

export type HarnessErrorCause =
  | "timeout"
  | "sandbox_api"
  | "sandbox_stream"
  | "unknown";

export function classifyHarnessError(
  err: unknown,
  signal?: AbortSignal,
): HarnessErrorCause {
  if (
    signal?.aborted ||
    (err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError"))
  ) {
    return "timeout";
  }
  if (err instanceof APIError) return "sandbox_api";
  if (err instanceof StreamError) return "sandbox_stream";
  return "unknown";
}

// ─── Harness credentials (optional env → runtime guard) ─────────────────────

export interface HarnessCredentials {
  anthropicApiKey: string;
  vercelToken: string;
  vercelTeamId: string;
  vercelProjectId: string;
}

const HARNESS_CREDENTIAL_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "VERCEL_TOKEN",
  "VERCEL_TEAM_ID",
  "VERCEL_PROJECT_ID",
] as const;

/** The harness env keys currently absent (empty array = fully configured). */
export function missingHarnessCredentialNames(): string[] {
  return HARNESS_CREDENTIAL_ENV_KEYS.filter((key) => !env[key]);
}

function readHarnessCredentials(): HarnessCredentials | null {
  const { ANTHROPIC_API_KEY, VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } =
    env;
  if (
    !ANTHROPIC_API_KEY ||
    !VERCEL_TOKEN ||
    !VERCEL_TEAM_ID ||
    !VERCEL_PROJECT_ID
  ) {
    return null;
  }
  return {
    anthropicApiKey: ANTHROPIC_API_KEY,
    vercelToken: VERCEL_TOKEN,
    vercelTeamId: VERCEL_TEAM_ID,
    vercelProjectId: VERCEL_PROJECT_ID,
  };
}

/** Name ONLY the missing vars — surfaces verbatim in /process 503s (§9.1). */
export function requireHarnessCredentials(): HarnessCredentials {
  const creds = readHarnessCredentials();
  if (!creds) {
    throw new Error(
      `Claude Code harness is not configured — missing: ${missingHarnessCredentialNames().join(", ")}`,
    );
  }
  return creds;
}

type SandboxProvider = ReturnType<typeof createVercelSandbox>;

interface SharedSandboxState {
  sandbox: Sandbox;
  provider: SandboxProvider;
  createdAt: number;
}

const globalStore = globalThis as typeof globalThis & {
  __vendraSharedSandbox?: {
    current: SharedSandboxState | null;
    creating: Promise<SharedSandboxState> | null;
    lastUsedAt: number;
  };
};

const store =
  globalStore.__vendraSharedSandbox ??
  (globalStore.__vendraSharedSandbox = {
    current: null,
    creating: null,
    lastUsedAt: 0,
  });

/**
 * Pre-bake the Claude Code bridge onto a fresh sandbox (one throwaway
 * session runs the adapter's bootstrap recipe) so real sessions skip the
 * npm install. Best-effort: on failure the first session per port pays the
 * bootstrap itself.
 */
async function bakeBridge(
  provider: SandboxProvider,
  anthropicApiKey: string,
): Promise<void> {
  const signal = AbortSignal.timeout(BAKE_TIMEOUT_MS);
  try {
    const session = await provider.createSession({ abortSignal: signal });
    try {
      await prepareSandboxForHarness({
        session,
        harnesses: [
          createClaudeCode({
            model: env.HARNESS_MODEL,
            auth: { anthropic: { apiKey: anthropicApiKey } },
          }),
        ],
        abortSignal: signal,
      });
      vendraLog("sandbox.baked");
    } finally {
      await session.stop();
    }
  } catch (err) {
    vendraWarn("sandbox.bake_failed", {
      note: "sessions will bootstrap on demand",
      ...harnessErrorFields(err),
    });
  }
}

async function createShared(): Promise<SharedSandboxState> {
  const creds = requireHarnessCredentials();
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create({
      runtime: "node24",
      ports: [...SANDBOX_BRIDGE_PORTS],
      teamId: creds.vercelTeamId,
      projectId: creds.vercelProjectId,
      token: creds.vercelToken,
      networkPolicy: { allow: SANDBOX_EGRESS_ALLOWLIST },
      timeout: SANDBOX_TIMEOUT_MS,
      // Sandbox-wide default env — the only route to the Claude Code CLI's
      // effort override (the adapter spawns the bridge with a fixed env set).
      env: { CLAUDE_CODE_EFFORT_LEVEL: env.HARNESS_EFFORT_LEVEL },
    });
  } catch (err) {
    vendraError("sandbox.create_failed", harnessErrorFields(err));
    throw err;
  }
  const provider = createVercelSandbox({
    sandbox,
    bridgePorts: [...SANDBOX_BRIDGE_PORTS],
  });
  vendraLog("sandbox.created");
  await bakeBridge(provider, creds.anthropicApiKey);
  const state: SharedSandboxState = {
    sandbox,
    provider,
    createdAt: Date.now(),
  };
  scheduleProactiveRenewal(state);
  return state;
}

async function retire(state: SharedSandboxState | null): Promise<void> {
  if (!state) return;
  try {
    await state.sandbox.stop();
    vendraLog("sandbox.retired");
  } catch (err) {
    vendraWarn("sandbox.retire_failed", {
      note: "already gone?",
      ...harnessErrorFields(err),
    });
  }
}

function replaceAndRetireGracefully(state: SharedSandboxState): void {
  if (store.current !== state) return;
  store.current = null;
  const timer = setTimeout(() => void retire(state), RETIRE_GRACE_MS);
  timer.unref();
}

/** Renew ahead of the hard lifetime cap — only when recently used. */
function scheduleProactiveRenewal(state: SharedSandboxState): void {
  const timer = setTimeout(() => {
    if (store.current !== state) return;
    const recentlyUsed = Date.now() - store.lastUsedAt < MAX_SANDBOX_AGE_MS;
    replaceAndRetireGracefully(state);
    if (recentlyUsed) {
      vendraLog("sandbox.renewal", { reason: "recently used" });
      void getSharedSandboxProvider().catch((err) =>
        vendraError("sandbox.renewal_failed", harnessErrorFields(err)),
      );
    } else {
      vendraLog("sandbox.idle_cold", { reason: "idle at lifetime cap" });
    }
  }, MAX_SANDBOX_AGE_MS);
  timer.unref();
}

/**
 * Get the shared sandbox provider, creating/renewing as needed. `forceFresh`
 * retires the current sandbox first — the one-shot retry when session
 * creation fails on a sandbox that may have expired underneath us.
 */
export async function getSharedSandboxProvider(options?: {
  forceFresh?: boolean;
}): Promise<SandboxProvider> {
  store.lastUsedAt = Date.now();

  if (options?.forceFresh && store.current) {
    const old = store.current;
    store.current = null;
    void retire(old);
  }

  const aged =
    store.current !== null &&
    Date.now() - store.current.createdAt > MAX_SANDBOX_AGE_MS;
  if (aged && store.current) {
    replaceAndRetireGracefully(store.current);
  }

  if (store.current) return store.current.provider;

  store.creating ??= createShared()
    .then((state) => {
      store.current = state;
      return state;
    })
    .finally(() => {
      store.creating = null;
    });

  const state = await store.creating;
  return state.provider;
}

/**
 * Boot-time warmup (instrumentation.ts): best-effort, and missing creds
 * log-and-skip — boot must never crash on an unconfigured harness.
 */
export function warmSharedSandbox(): void {
  const missing = missingHarnessCredentialNames();
  if (missing.length > 0) {
    vendraWarn("sandbox.warmup_skipped", { missing: missing.join(", ") });
    return;
  }
  getSharedSandboxProvider()
    .then(() => vendraLog("sandbox.warmup_done"))
    .catch((err) => vendraError("sandbox.warmup_failed", harnessErrorFields(err)));
}

// ─── Shared harness observability ────────────────────────────────────────────

const reporterStore = globalThis as typeof globalThis & {
  __vendraHarnessFileReporter?: ReturnType<typeof createFileReporter>;
};

/** Failed turns land in `.harness-logs/events.jsonl` (gitignored, local only). */
export function getHarnessFileReporter(): ReturnType<typeof createFileReporter> {
  return (reporterStore.__vendraHarnessFileReporter ??= createFileReporter({
    dir: ".harness-logs",
    failOnly: true,
  }));
}

// ─── Shared harness concurrency ──────────────────────────────────────────────

const semaphoreStore = globalThis as typeof globalThis & {
  __vendraProcessSemaphore?: Semaphore;
  __vendraCoverageSemaphore?: Semaphore;
};

/**
 * The doc-lane semaphore: ≤ pool − 1 so doc runs can never starve the
 * coverage determination out of the bridge pool. 3 + 1 = the 4 ports exactly.
 */
export function getHarnessSemaphore(): Semaphore {
  return (semaphoreStore.__vendraProcessSemaphore ??= new Semaphore(
    Math.min(env.HARNESS_MAX_CONCURRENCY, SANDBOX_BRIDGE_PORTS.length - 1),
  ));
}

/** The DEDICATED single-slot lane for coverage-determination sessions. */
export function getCoverageSemaphore(): Semaphore {
  return (semaphoreStore.__vendraCoverageSemaphore ??= new Semaphore(1));
}
