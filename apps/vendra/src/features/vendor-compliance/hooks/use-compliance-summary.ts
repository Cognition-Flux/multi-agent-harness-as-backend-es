"use client";

/**
 * Durable coverage/gate state (SPEC §7.4): polls the compliance summary
 * on an adaptive cadence — 5s while determining, 15s while a live
 * stream is attached / stale, 30s idle — and kicks the coverage
 * determination on the false→true determining transition (deduped per
 * mount).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { ComplianceSummaryPayload } from "@/server/compliance-summary";

export function useComplianceSummary(initial: ComplianceSummaryPayload) {
  const [summary, setSummary] = useState(initial);
  const kickedRef = useRef(false);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/compliance-summary", {
        cache: "no-store",
      });
      if (res.status === 401) {
        // The session expired mid-visit — a silently frozen portal is worse
        // than a re-auth round trip.
        window.location.href = "/login?expired=1";
        return;
      }
      if (!res.ok) return;
      const next = (await res.json()) as ComplianceSummaryPayload;
      setSummary(next);
    } catch {
      // Transient network failure — the next poll tick retries.
    }
  }, []);

  // Kick on the false→true determining transition — once per mount episode.
  // Runs on every summary refresh so a failed kick retries on the next tick.
  useEffect(() => {
    if (summary.coverage.determining && !kickedRef.current) {
      kickedRef.current = true;
      fetch("/api/vendor/coverage-determination", { method: "POST" })
        .then((res) => {
          if (!res.ok) kickedRef.current = false;
        })
        .catch(() => {
          kickedRef.current = false;
        });
    }
    if (!summary.coverage.determining) {
      kickedRef.current = false;
    }
  }, [summary]);

  // Adaptive poll cadence.
  useEffect(() => {
    const determining = summary.coverage.determining;
    const stale = summary.coverage.summarySource === "stale";
    const interval = determining ? 5_000 : stale ? 15_000 : 30_000;
    const timer = setInterval(() => void refresh(), interval);
    return () => clearInterval(timer);
  }, [summary.coverage.determining, summary.coverage.summarySource, refresh]);

  return { summary, refresh };
}
