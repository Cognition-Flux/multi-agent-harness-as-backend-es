/**
 * Boot hooks (SPEC §6.1, §6.8): warm the shared sandbox (logs-and-skips
 * when the harness creds are absent — boot never crashes) and start the
 * in-process expiry-sweep scheduler.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmSharedSandbox } = await import("@/server/harness/sandbox");
    const { startSweepScheduler } = await import("@/server/sweep");
    warmSharedSandbox();
    startSweepScheduler();
  }
}
