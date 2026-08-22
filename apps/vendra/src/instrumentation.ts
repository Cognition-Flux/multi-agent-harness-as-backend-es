/**
 * Boot hooks (SPEC §6.1, §6.8): warm the shared sandbox (logs-and-skips
 * when the harness creds are absent — boot never crashes) and start the
 * in-process expiry-sweep scheduler.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmSharedSandbox } = await import("@/server/harness/sandbox");
    const { startSweepScheduler } = await import("@/server/sweep");
    const { startMemoryDrainScheduler } = await import("@/server/memory/drain");
    warmSharedSandbox();
    startSweepScheduler();
    // The memory drain runs on its own short interval — the sweep is hourly
    // and would leave a vendor's memory an hour behind the chat (§22).
    startMemoryDrainScheduler();
  }
}
