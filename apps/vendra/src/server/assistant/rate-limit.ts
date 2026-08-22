/**
 * In-process fixed-window rate limiter for the assistant chat route.
 *
 * Deliberately NOT a DB counter: the app runs as a single Next.js server —
 * one process IS the fleet — and the fixed-window trade-off (worst-case
 * boundary burst = 2× cap) is acceptable for a quota guard.
 */

interface WindowState {
  windowStart: number;
  count: number;
}

const store = globalThis as typeof globalThis & {
  __vendraAssistantRateWindows?: Map<string, WindowState>;
};

function getWindows(): Map<string, WindowState> {
  return (store.__vendraAssistantRateWindows ??= new Map<string, WindowState>());
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
}

/**
 * Return a consumed slot when the request was rejected before doing any
 * work (409 thread-busy, 503 lease failure) — otherwise a client retrying
 * against a long-streaming turn locks itself out of the whole window.
 */
export function refundRateLimit(key: string, windowMs: number): void {
  const state = getWindows().get(key);
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  if (state?.windowStart === windowStart && state.count > 0) {
    state.count -= 1;
  }
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const windows = getWindows();
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const state = windows.get(key);
  if (state?.windowStart !== windowStart) {
    windows.set(key, { windowStart, count: 1 });
    // Opportunistic sweep keeps the map bounded without a timer.
    if (windows.size > 500) {
      for (const [k, v] of windows) {
        if (v.windowStart !== windowStart) windows.delete(k);
      }
    }
    return { allowed: maxRequests >= 1, count: 1 };
  }
  // A rejected request consumes nothing (SPEC §23.15): incrementing on the way
  // to a refusal inflated the counter unboundedly under retry spam, and a
  // refund after N rejections no longer restores a usable slot.
  if (state.count >= maxRequests) {
    return { allowed: false, count: state.count };
  }
  state.count += 1;
  return { allowed: true, count: state.count };
}
