/**
 * Vendor-assistant chat session lifecycle over the shared sandbox.
 *
 * One Claude Code session per vendor thread, but a bridge port is held only
 * WHILE a turn streams: every turn resumes the parked session (`resumeFrom`
 * persisted in this app's Postgres), runs, then parks via `session.stop()`
 * — stop (unlike detach) RELEASES the bridge-port lease and its
 * sandbox-stop is a wrap-mode no-op, so the shared sandbox survives.
 * Resuming from stop-state respawns the runtime on the pre-baked sandbox
 * (seconds, not the cold-boot minutes).
 *
 * Concurrency: chat turns draw slots from the SAME shared harness semaphore
 * the document pipeline uses (one slot ≈ one bridge port; doc lane ≤3 +
 * coverage lane 1 = the 4-port pool), so total live sessions can never
 * oversubscribe the pool. A per-vendor try-lock additionally rejects a
 * second in-flight turn on the same thread (the route maps it to 409).
 * In-process only — this app runs as a single Next.js server.
 */
import { randomUUID } from "node:crypto";
import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { HarnessAgent } from "@ai-sdk/harness/agent";

import { env } from "@/env";
import { vendraError, vendraWarn } from "@/server/harness/log";
import {
  getHarnessFileReporter,
  getHarnessSemaphore,
  getSharedSandboxProvider,
} from "@/server/harness/sandbox";

import type { StoredAssistantSession } from "./store";
import type { buildAssistantTools } from "./tools";
import {
  clearAssistantSessionState,
  loadAssistantSessionState,
  saveAssistantSessionState,
} from "./store";

const store = globalThis as typeof globalThis & {
  __vendraAssistantActiveThreads?: Set<string>;
};

function getActiveThreads(): Set<string> {
  return (store.__vendraAssistantActiveThreads ??= new Set<string>());
}

type AssistantAgent = HarnessAgent<
  ReturnType<typeof createClaudeCode>,
  ReturnType<typeof buildAssistantTools>
>;

export interface AssistantTurnLease {
  agent: AssistantAgent;
  session: Awaited<ReturnType<AssistantAgent["createSession"]>>;
  /** True when no parked session could be resumed (memory block re-injects). */
  isFreshSession: boolean;
  /**
   * End the turn: park the session (stop + persist resume state) when
   * `keepResumable`, else destroy it and clear the stored state. Always
   * releases the shared slot and the thread lock. Idempotent.
   */
  finish(options: { keepResumable: boolean }): Promise<void>;
}

export interface LeaseAssistantTurnInput {
  vendorUuid: string;
  vendorId: number;
  instructions: string;
  tools: ReturnType<typeof buildAssistantTools>;
  abortSignal: AbortSignal;
}

/** A second turn is already streaming on this vendor's thread. */
export const ASSISTANT_THREAD_BUSY = Symbol("assistant-thread-busy");

export async function leaseAssistantTurn(
  input: LeaseAssistantTurnInput,
): Promise<AssistantTurnLease | typeof ASSISTANT_THREAD_BUSY> {
  const active = getActiveThreads();
  if (active.has(input.vendorUuid)) return ASSISTANT_THREAD_BUSY;
  active.add(input.vendorUuid);

  let releaseSlot: (() => void) | undefined;
  let finished = false;
  const releaseAll = () => {
    releaseSlot?.();
    releaseSlot = undefined;
    active.delete(input.vendorUuid);
  };

  try {
    releaseSlot = await getHarnessSemaphore().acquire(input.abortSignal);

    const makeAgent = (
      sandbox: Awaited<ReturnType<typeof getSharedSandboxProvider>>,
    ): AssistantAgent =>
      new HarnessAgent({
        harness: createClaudeCode({
          model: env.HARNESS_MODEL,
          maxTurns: 12,
          startupTimeoutMs: 180_000,
          // Pin direct Anthropic auth — same rule-1 exclusion of ambient
          // gateway/OIDC fallbacks as the document lane.
          auth: { anthropic: { apiKey: env.ANTHROPIC_API_KEY } },
        }),
        sandbox,
        instructions: input.instructions,
        tools: input.tools,
        activeTools: [
          "getComplianceState",
          "getDocumentDetails",
          "rememberFacts",
        ],
        // No built-in is active; this gates them a second time regardless.
        permissionMode: "allow-reads",
        telemetry: { integrations: [getHarnessFileReporter()] },
      });

    const stored = await loadAssistantSessionState(input.vendorUuid);

    const createFresh = async (agent: AssistantAgent) =>
      agent.createSession({
        sessionId: `vendor-chat-${randomUUID()}`,
        abortSignal: input.abortSignal,
      });

    let agent = makeAgent(await getSharedSandboxProvider());
    let session: Awaited<ReturnType<AssistantAgent["createSession"]>>;
    let isFreshSession = false;
    try {
      session = stored
        ? await agent.createSession({
            sessionId: stored.sessionId,
            resumeFrom: stored.resumeState as HarnessAgentResumeSessionState,
            abortSignal: input.abortSignal,
          })
        : await createFresh(agent);
      isFreshSession = !stored;
    } catch (err) {
      // Only a genuinely dead sandbox warrants destructive recovery. A
      // client abort / turn timeout is not a sandbox problem; a leased-out
      // port pool is not either (forceFresh there would retire the LIVE
      // sandbox under every in-flight document run).
      if (input.abortSignal.aborted) throw err;
      if (
        err instanceof Error &&
        err.message.includes("No available bridge port")
      ) {
        throw err;
      }
      vendraWarn("assistant.session_recovered", {
        vendor: input.vendorUuid,
        err: err instanceof Error ? err.message : String(err),
      });
      if (stored) await clearAssistantSessionState(input.vendorUuid);
      agent = makeAgent(await getSharedSandboxProvider({ forceFresh: true }));
      session = await createFresh(agent);
      isFreshSession = true;
    }

    const finish = async ({ keepResumable }: { keepResumable: boolean }) => {
      if (finished) return;
      finished = true;
      try {
        if (keepResumable) {
          // stop(), not detach(): detach keeps the bridge-port lease for the
          // sandbox's lifetime — parked leases would starve the 4-port pool.
          const resumeState = await session.stop();
          const state: StoredAssistantSession = {
            sessionId: session.sessionId,
            resumeState,
            updatedAt: new Date().toISOString(),
          };
          await saveAssistantSessionState(
            input.vendorUuid,
            input.vendorId,
            state,
          );
        } else {
          await session.destroy();
          await clearAssistantSessionState(input.vendorUuid);
        }
      } catch (err) {
        vendraError("assistant.park_failed", {
          vendor: input.vendorUuid,
          err: err instanceof Error ? err.message : String(err),
        });
        await session.destroy().catch(() => undefined);
        await clearAssistantSessionState(input.vendorUuid).catch(
          () => undefined,
        );
      } finally {
        releaseAll();
      }
    };

    return { agent, session, isFreshSession, finish };
  } catch (err) {
    releaseAll();
    throw err;
  }
}
