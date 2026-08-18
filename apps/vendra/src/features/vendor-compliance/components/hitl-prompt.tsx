"use client";

/**
 * The HITL confirmation card (SPEC §7.3): amber alert block, 1s
 * countdown to expiry, buttons disabled on submitting/expired, "otherwise
 * processing continues automatically" footer. A 404 on answer means the
 * window already settled (the fail-open raced the click) — clear quietly.
 */
import { CheckCircle2, Clock } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, Loader } from "@/components/ui/primitives";

import type { VendorDocConfirmationPart } from "../lib/vendor-harness-contract";

export function HitlPrompt({
  documentUuid,
  confirmation,
}: {
  documentUuid: string;
  confirmation: VendorDocConfirmationPart;
}) {
  const [submitting, setSubmitting] = useState(false);
  /** Which button was clicked (visual only) — shows the Loader in that button. */
  const [pendingAnswer, setPendingAnswer] = useState<boolean | null>(null);
  const [answered, setAnswered] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(confirmation.expiresAt).getTime() - Date.now()),
  );
  // The window size as seen at mount — the 100% mark for the draining bar.
  const [windowMs] = useState(() =>
    Math.max(1, new Date(confirmation.expiresAt).getTime() - Date.now()),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingMs(
        Math.max(0, new Date(confirmation.expiresAt).getTime() - Date.now()),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [confirmation.expiresAt]);

  const expired = remainingMs <= 0;
  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000)
    .toString()
    .padStart(2, "0");
  const timeRatio = Math.max(0, Math.min(1, remainingMs / windowMs));
  // Final stretch: the draining bar shifts warning → destructive.
  const urgent = timeRatio <= 0.25;

  async function answer(confirmed: boolean) {
    setSubmitting(true);
    setPendingAnswer(confirmed);
    setAnswerError(null);
    try {
      const res = await fetch(`/api/vendor/documents/${documentUuid}/confirmation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmationUuid: confirmation.confirmationUuid,
          confirmed,
        }),
      });
      // 200 = answered; 404 = already settled (fail-open raced the click) —
      // either way the server's re-written part clears the prompt.
      if (res.ok || res.status === 404) {
        setAnswered(true);
      } else {
        setAnswerError("No se pudo registrar su respuesta — intente de nuevo.");
      }
    } catch {
      setAnswerError("No se pudo registrar su respuesta — verifique su conexión e intente de nuevo.");
    } finally {
      setSubmitting(false);
      setPendingAnswer(null);
    }
  }

  if (answered) {
    return (
      <div
        role="status"
        className="flex animate-fade-in items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-muted-foreground"
      >
        <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0 text-success" />
        Respuesta registrada — el procesamiento continúa…
      </div>
    );
  }

  // The window lapsed before an answer landed: the run continues on the
  // fail-open path, so a live form here would be a dead control.
  if (expired) {
    return (
      <div
        role="status"
        className="flex animate-fade-in items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
      >
        <Clock aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        La ventana de confirmación se cerró — el procesamiento continúa automáticamente.
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3"
    >
      <p className="text-sm font-medium">{confirmation.question}</p>
      <div aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-warning/20">
        <div
          className={
            urgent
              ? "h-full rounded-full bg-destructive transition-[width] duration-1000 ease-linear"
              : "h-full rounded-full bg-warning transition-[width] duration-1000 ease-linear"
          }
          style={{ width: `${Math.round(timeRatio * 100)}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void answer(true)}
          disabled={submitting}
        >
          {pendingAnswer === true ? <Loader className="h-3 w-3 text-current" /> : null}
          Sí
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void answer(false)}
          disabled={submitting}
        >
          {pendingAnswer === false ? <Loader className="h-3 w-3 text-current" /> : null}
          No
        </Button>
      </div>
      {answerError ? (
        <p role="alert" className="text-xs text-destructive">
          {answerError}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Responda en un plazo de <span className="tabular-nums">{minutes}:{seconds}</span> — de lo
        contrario, el procesamiento continúa automáticamente.
      </p>
    </div>
  );
}
