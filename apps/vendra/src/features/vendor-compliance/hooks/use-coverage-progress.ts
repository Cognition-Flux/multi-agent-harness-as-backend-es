"use client";

/**
 * Live coverage-determination progress (SPEC §7.4) — an ATTACH-ONLY
 * `useChat`: `resumeStream()` against the GET stream route via
 * `prepareReconnectToStreamRequest`, never `sendMessage`. All parts are
 * TRANSIENT — delivered via `onData` only, behind runtime guards
 * (`@ai-sdk/react` payloads arrive type-erased) — the durable state stays
 * the polled compliance summary. A 204 (no live run on this instance) just
 * ends the attempt; we retry every 4s while the summary says determining.
 */
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai"; // transports import from `ai`, NOT @ai-sdk/react
import { useEffect, useMemo, useRef, useState } from "react";

import {
  parseCoverageNarrationPart,
  parseCoverageStagePart,
  type CoverageStagePart,
  type CoverageUIMessage,
} from "../lib/vendor-harness-contract";

const ATTACH_RETRY_MS = 4_000;
const TERMINAL_STAGES = new Set(["converged", "unavailable"]);

export interface CoverageProgress {
  stage: CoverageStagePart | null;
  /** The agent's latest narration sentence (accumulated text tail). */
  narration: string | null;
  /** True while this tab is attached to a live run's stream. */
  attached: boolean;
}

export function useCoverageProgress(options: {
  determining: boolean;
  /** Fires on a terminal stage — invalidate the durable summary immediately. */
  onSettled: () => void;
}): CoverageProgress {
  const { determining, onSettled } = options;
  const [stage, setStage] = useState<CoverageStagePart | null>(null);
  const [narration, setNarration] = useState<string | null>(null);
  const narrationBufferRef = useRef("");
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const transport = useMemo(
    () =>
      new DefaultChatTransport<CoverageUIMessage>({
        // Attach-only: sendMessage is never called; every attach goes through
        // the reconnect path below.
        api: "/api/vendor/coverage-determination/stream",
        prepareReconnectToStreamRequest: () => ({
          api: "/api/vendor/coverage-determination/stream",
        }),
      }),
    [],
  );

  const { resumeStream, status } = useChat<CoverageUIMessage>({
    id: "coverage-progress",
    transport,
    onData: (part) => {
      if (part.type === "data-coverage-stage") {
        const parsed = parseCoverageStagePart(part.data);
        if (!parsed) return;
        // A fresh run resets the narration tail.
        if (parsed.stage === "queued" || parsed.stage === "starting") {
          narrationBufferRef.current = "";
          setNarration(null);
        }
        setStage(parsed);
        if (TERMINAL_STAGES.has(parsed.stage)) {
          onSettledRef.current();
        }
      } else if (part.type === "data-coverage-narration") {
        const parsed = parseCoverageNarrationPart(part.data);
        if (!parsed) return;
        narrationBufferRef.current = (
          narrationBufferRef.current + parsed.text
        ).slice(-400);
        // Show the latest sentence-ish tail, trimmed at a sentence boundary
        // when one exists.
        const buffer = narrationBufferRef.current;
        const lastStop = buffer.lastIndexOf(". ", buffer.length - 2);
        setNarration((lastStop >= 0 ? buffer.slice(lastStop + 2) : buffer).trim() || null);
      }
    },
  });

  // A resumed transient-only stream never emits a message start, so useChat
  // status sits at "submitted" for its whole life (measured live) — "ready"
  // is the ONLY not-attached state. Gating re-attach on anything narrower
  // opened overlapping subscriptions (observed as duplicated stage/narration
  // parts).
  const attached = status !== "ready" && status !== "error";

  // Live status via a ref: `status` must NOT be an effect dep — its
  // transitions would re-run the effect, whose initial attach would open a
  // SECOND subscription on the already-attached stream.
  const statusRef = useRef(status);
  statusRef.current = status;

  // Attach while determining; a 204 attempt just returns → retry on the tick.
  useEffect(() => {
    if (!determining) {
      setStage(null);
      setNarration(null);
      narrationBufferRef.current = "";
      return;
    }
    let cancelled = false;
    const tryAttach = () => {
      // Only attach when no attempt is live (204 / ended → back to "ready").
      if (cancelled || statusRef.current !== "ready") return;
      void resumeStream().catch(() => undefined);
    };
    tryAttach();
    const timer = setInterval(tryAttach, ATTACH_RETRY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [determining, resumeStream]);

  return { stage, narration, attached };
}
