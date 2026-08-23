"use client";

/**
 * Animated miniature of the vendor assistant, reproducing the real AI-Elements
 * idioms from assistant-chat.tsx verbatim: the "Pensando…" shimmer status row,
 * tool-activity pills (Consultando su registro de cumplimiento… / Tomando
 * nota… / Redactando una propuesta de directiva…), the collapsed reasoning
 * trigger ("Proceso de razonamiento"), streamed response text, and the
 * Delegado-tier directive proposal. Last scene = the settled conversation.
 */

import {
  ArrowUpIcon,
  BotIcon,
  ChevronRightIcon,
  FileSignatureIcon,
  LightbulbIcon,
  ListChecksIcon,
  SquareIcon,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

import { useSceneLoop, useTypewriter } from "../motion";
import { Caret, MockFrame, MockShimmerText, ToolPill } from "./mock-frame";

const DURATIONS = [550, 850, 950, 550, 1900, 650, 850, 3200] as const;
// 0: user msg · 1: Pensando… · 2: tool inflight · 3: tool done + razonamiento
// 4: respuesta streaming · 5: memoria inflight · 6: memoria ok + directiva
// 7: propuesta enviada (settled)

const RESPONSE =
  "Su póliza primaria aporta $1.000.000 y la umbrella $500.000 — el requisito exige $2.000.000. Le faltan $500.000: puede subir un endoso o una póliza de exceso.";

export function AssistantScene() {
  const step = useSceneLoop(DURATIONS);
  // `done` snaps the reveal to complete once the scene moves past the
  // streaming step, so a throttled tab can never park on a truncated answer.
  const streamed = useTypewriter(RESPONSE, step >= 4, step > 4);
  const busy = step >= 1 && step <= 6;
  const typing = streamed.length < RESPONSE.length && step >= 4;

  return (
    <MockFrame
      title="Asistente"
      badge={<Badge variant="agent" className="text-[10px]">Delegado</Badge>}
    >
      <div className="space-y-3">
        {/* Panel header, as in assistant-panel.tsx */}
        <div className="flex items-center gap-2 border-b border-border/60 pb-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-agent/10">
            <BotIcon className="h-3.5 w-3.5 text-agent" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold leading-tight">Asistente</p>
            <p className="truncate text-[9px] text-muted-foreground">
              Con acceso a su registro de cumplimiento
            </p>
          </div>
        </div>

        {/* Conversation — fixed height, anchored to the bottom like a chat, so
            the empty space sits above the messages as history room. Sized to
            the tallest turn at each breakpoint (measured extent: 389px at
            320w, 287px at ≥1280w) so the opening question is never clipped. */}
        <div className="flex h-[25rem] flex-col justify-end gap-2 overflow-hidden sm:h-[21rem]">
          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-[11px] text-primary-foreground"
          >
            ¿Por qué mi cobertura general sigue por debajo del requisito?
          </m.div>

          {/* Pre-content thinking indicator (assistant-chat.tsx:434-445). */}
          <AnimatePresence>
            {step === 1 ? (
              <m.div
                key="thinking"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="flex items-center gap-1.5 text-[10px]"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-agent" />
                <MockShimmerText>Pensando…</MockShimmerText>
              </m.div>
            ) : null}
          </AnimatePresence>

          {/* Assistant turn: tool pills, reasoning trigger, streamed text. */}
          {step >= 2 ? (
            <div
              className={cn(
                "max-w-[92%] space-y-1.5 rounded-lg rounded-bl-sm border border-border/60 px-3 py-2",
                busy ? "bg-gradient-to-r from-agent/5 to-transparent" : "bg-card",
              )}
            >
              <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <ToolPill
                  icon={ListChecksIcon}
                  state={step >= 3 ? "done" : "inflight"}
                  pending="Consultando su registro de cumplimiento…"
                  finished="Se consultó su registro de cumplimiento"
                />
              </m.div>

              {step >= 3 ? (
                <m.button
                  type="button"
                  tabIndex={-1}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="pointer-events-none flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground"
                >
                  <LightbulbIcon className="h-3 w-3 text-agent" />
                  {typing ? (
                    <MockShimmerText>Pensando…</MockShimmerText>
                  ) : (
                    <span>Proceso de razonamiento</span>
                  )}
                  <ChevronRightIcon className="h-3 w-3" />
                </m.button>
              ) : null}

              {step >= 4 ? (
                <p className="text-[11px] leading-relaxed">
                  {streamed}
                  {typing ? <Caret /> : null}
                </p>
              ) : null}

              {step >= 5 ? (
                <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <ToolPill
                    icon={LightbulbIcon}
                    state={step >= 6 ? "done" : "inflight"}
                    pending="Tomando nota…"
                    finished="Anotado para la próxima vez"
                  />
                </m.div>
              ) : null}

              {step >= 6 ? (
                <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <ToolPill
                    icon={FileSignatureIcon}
                    state={step >= 7 ? "done" : "inflight"}
                    pending="Redactando una propuesta de directiva…"
                    finished="Propuesta enviada a revisión"
                  />
                </m.div>
              ) : null}
            </div>
          ) : null}

          {/* Delegado tier: the proposal lands in the superadmin console. */}
          <AnimatePresence>
            {step >= 7 ? (
              <m.div
                key="proposal"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="max-w-[92%] rounded-lg border border-agent/25 bg-agent/5 px-3 py-2"
              >
                <p className="flex items-center justify-between gap-2 text-[10px] font-semibold text-agent">
                  Directiva propuesta
                  <Badge variant="warning" className="text-[8px]">Pendiente</Badge>
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Aceptar: Póliza umbrella / de exceso de responsabilidad — nada se aplica sin
                  la aprobación de un humano.
                </p>
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Composer, as in prompt-input.tsx: ArrowUp ⇄ Square while busy. */}
        <div className="flex h-8 items-center justify-between gap-2 rounded-md border border-input bg-card pl-2.5 pr-1">
          <span className="truncate text-[10px] text-muted-foreground">
            Pregunte sobre su registro de cumplimiento…
          </span>
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground",
              busy && "ring-2 ring-agent/30",
            )}
          >
            {busy ? <SquareIcon className="h-3 w-3" /> : <ArrowUpIcon className="h-3.5 w-3.5" />}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="muted" className="text-[9px]">mem0 OSS · Qdrant · Ollama — todo local</Badge>
          <Badge variant="muted" className="text-[9px]">PII redactada antes de almacenar</Badge>
        </div>
      </div>
    </MockFrame>
  );
}
