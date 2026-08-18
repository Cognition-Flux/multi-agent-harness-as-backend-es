/**
 * Live per-vendor coverage-determination progress broadcast (SPEC §6.6)
 * — an in-process pub/sub the attach-only GET stream subscribes to. All
 * parts are TRANSIENT (delivered via `onData` only, never persisted): the
 * durable state stays the polled coverage summary.
 */
import type { UIMessageStreamWriter } from "ai";

import type {
  CoverageNarrationPart,
  CoverageStagePart,
  CoverageUIMessage,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";

type Subscriber = {
  writer: UIMessageStreamWriter<CoverageUIMessage>;
  end: () => void;
};

interface LiveRun {
  subscribers: Set<Subscriber>;
  lastStage: CoverageStagePart | null;
}

const globalStore = globalThis as typeof globalThis & {
  __vendraCoverageProgress?: Map<number, LiveRun>;
};

const liveRuns: Map<number, LiveRun> =
  globalStore.__vendraCoverageProgress ??
  (globalStore.__vendraCoverageProgress = new Map());

/** Pending grace-window closers (see endCoverageProgressAfter). */
const graceTimers = new Map<number, NodeJS.Timeout>();

export function beginCoverageProgress(vendorId: number): void {
  // A real run starting inside another episode's grace window adopts the
  // episode — cancel the pending close so it can't kill the live run.
  const pending = graceTimers.get(vendorId);
  if (pending) {
    clearTimeout(pending);
    graceTimers.delete(vendorId);
  }
  if (!liveRuns.has(vendorId)) {
    liveRuns.set(vendorId, { subscribers: new Set(), lastStage: null });
  }
}

export function hasLiveCoverageRun(vendorId: number): boolean {
  return liveRuns.has(vendorId);
}

export function publishCoverageStage(
  vendorId: number,
  data: CoverageStagePart,
): void {
  const run = liveRuns.get(vendorId);
  if (!run) return;
  run.lastStage = data;
  for (const sub of run.subscribers) {
    sub.writer.write({ type: "data-coverage-stage", data, transient: true });
  }
}

export function publishCoverageNarration(
  vendorId: number,
  data: CoverageNarrationPart,
): void {
  const run = liveRuns.get(vendorId);
  if (!run) return;
  for (const sub of run.subscribers) {
    sub.writer.write({ type: "data-coverage-narration", data, transient: true });
  }
}

/** Close the live run: final stage already published; end all subscribers. */
export function endCoverageProgress(vendorId: number): void {
  const pending = graceTimers.get(vendorId);
  if (pending) {
    clearTimeout(pending);
    graceTimers.delete(vendorId);
  }
  const run = liveRuns.get(vendorId);
  if (!run) return;
  liveRuns.delete(vendorId);
  for (const sub of run.subscribers) {
    sub.end();
  }
}

/**
 * Close the live run after a grace window. A no-run terminal broadcast
 * (signature hit / no inputs) that begins and ends synchronously is
 * unobservable — no subscriber can attach inside one synchronous block. The
 * grace keeps the episode open long enough for the client's 4s attach loop
 * to land and receive the replayed terminal stage.
 */
export function endCoverageProgressAfter(vendorId: number, ms: number): void {
  if (graceTimers.has(vendorId)) return;
  const timer = setTimeout(() => {
    graceTimers.delete(vendorId);
    endCoverageProgress(vendorId);
  }, ms);
  timer.unref();
  graceTimers.set(vendorId, timer);
}

/**
 * Attach a stream subscriber to the live run. Returns a promise that
 * resolves when the run ends (the stream route's execute awaits it).
 * Replays the last stage on attach so a late subscriber paints immediately.
 */
export function subscribeCoverageProgress(
  vendorId: number,
  writer: UIMessageStreamWriter<CoverageUIMessage>,
): Promise<void> | null {
  const run = liveRuns.get(vendorId);
  if (!run) return null;
  return new Promise<void>((resolve) => {
    const sub: Subscriber = { writer, end: () => resolve() };
    run.subscribers.add(sub);
    if (run.lastStage) {
      writer.write({
        type: "data-coverage-stage",
        data: run.lastStage,
        transient: true,
      });
    }
  });
}
