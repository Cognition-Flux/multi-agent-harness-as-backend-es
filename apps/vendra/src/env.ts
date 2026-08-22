import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Validated runtime env — the ONLY env read point (SPEC §9.1).
 *
 * Boot semantics: only DB/auth/storage keys are hard-required. The four
 * harness keys are optional-at-boot, runtime-guarded — missing keys degrade
 * gracefully: warm-boot logs-and-skips, uploads queue, /process returns a
 * named 503, and /api/health reports `harness: unconfigured`.
 */
export const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  server: {
    // ── Database / auth ──────────────────────────────────────────────────
    VENDOR_DATABASE_URL: z.string().min(1),
    // ≥32 chars per better-auth guidance — it keys session signing,
    // encryption, and hashing (SPEC §17 C9). The live secret is 64 chars.
    BETTER_AUTH_SECRET: z.string().min(32),
    APP_URL: z.string().url().default("http://localhost:3000"),

    // ── Object storage (MinIO locally, real S3 in cloud — §6.12) ─────────
    S3_ENDPOINT_URL: z.string().url().optional(),
    S3_PUBLIC_ENDPOINT_URL: z.string().url().optional(),
    S3_REGION: z.string().default("us-east-1"),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    VENDOR_DOCS_BUCKET: z.string().default("vendor-docs"),

    // ── Claude Code harness (optional at boot, runtime-guarded — §6.1) ───
    ANTHROPIC_API_KEY: z.string().optional(),
    VERCEL_TOKEN: z.string().optional(),
    VERCEL_TEAM_ID: z.string().optional(),
    VERCEL_PROJECT_ID: z.string().optional(),
    // Sonnet default (§9.1): a production incident with opus@max (24-min
    // determinations, silent timeouts) makes sonnet the safer default; opus
    // is one env change.
    HARNESS_MODEL: z.string().default("claude-sonnet-4-6"),
    HARNESS_EFFORT_LEVEL: z
      .enum(["low", "medium", "high", "xhigh", "max"])
      .default("high"),
    HARNESS_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(3),

    // ── Assistant memory index (optional at boot — §22) ─────────────────
    // All three of these plus ANTHROPIC_API_KEY must be present for semantic
    // recall; with any of them missing the assistant falls back to recency
    // recall (the pre-mem0 behaviour) and /api/health says `unconfigured`.
    // Nothing else in the app depends on them.
    VENDOR_QDRANT_URL: z.string().url().optional(),
    VENDOR_OLLAMA_URL: z.string().url().optional(),
    /** Changing this requires a re-index — the collection's dims are fixed. */
    VENDOR_MEMORY_EMBED_MODEL: z.string().optional(),
    VENDOR_MEMORY_LLM_MODEL: z.string().optional(),
    /** Test-only override of the 20 s memory-drain interval (§22). */
    VENDOR_MEMORY_DRAIN_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .optional(),

    // ── Product knobs ────────────────────────────────────────────────────
    VENDOR_AGENT_VERBOSITY: z.enum(["low", "high"]).default("high"),
    /** Test-only override of the hourly sweep interval (§6.8, §11.2). */
    VENDOR_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().optional(),
    /** Test-only override of the 5-minute HITL confirmation window. */
    VENDOR_CONFIRMATION_WINDOW_MS: z.coerce.number().int().positive().optional(),
  },
  client: {},
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION || !!process.env.CI,
  // Compose/IaC can inject "" for unset optionals; `.optional()` permits
  // undefined but NOT "" — coerce so an empty value reads as "not configured"
  // instead of failing its validator at boot.
  emptyStringAsUndefined: true,
});
