"use client";

/**
 * The assistant working a genuinely multi-step request, end to end in one
 * turn: it reads the compliance record, opens the document that failed,
 * streams an answer, files a memory fact and drafts a directive proposal —
 * then the same proposal is shown as it lands in the governance console,
 * pending a human decision.
 *
 * Every label is verbatim from the real surfaces: the question is one of
 * assistant-chat.tsx's SUGGESTIONS, the pills are its TOOL_LABELS (four of
 * the five host tools), the reasoning trigger is the AI-Elements one, and the
 * proposal card copies policy-builder.tsx's "Propuestas del asistente" block
 * with directives.ts's summary-line format. Last scene = settled.
 */

import {
  BotIcon,
  FileSearchIcon,
  FileSignatureIcon,
  LightbulbIcon,
  ListChecksIcon,
  SquareIcon,
  ArrowUpIcon,
  ChevronRightIcon,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

import { useSceneLoop, useTypewriter } from "../motion";
import { Caret, MockFrame, MockShimmerText, ToolPill } from "./mock-frame";

const DURATIONS = [600, 750, 900, 900, 600, 2200, 750, 900, 3600] as const;
// 0 pregunta · 1 Pensando… · 2 expediente · 3 documento · 4 razonamiento
// 5 respuesta transmitida · 6 memoria · 7 propuesta redactada
// 8 la propuesta ya en la consola de gobernanza (asentado)

/** SUGGESTIONS[0] in assistant-chat.tsx. */
const QUESTION = "¿Qué falta para poder activar mi cuenta?";

const RESPONSE =
  "Le faltan 2 de 11 categorías. «Acuerdos firmados» no se acredita porque el contrato marco que subió no pasa la validación de firma; «Seguro de compensación laboral» todavía no tiene ningún documento que lo respalde.";

export function AssistantTaskScene() {
  const step = useSceneLoop(DURATIONS);
  // `done` snaps the reveal complete once the loop moves past the streaming
  // beat — a throttled tab clamps this timer chain to ~1s per tick and would
  // otherwise park the settled scene on half a sentence.
  const streamed = useTypewriter(RESPONSE, step >= 5, step > 5);
  const typing = streamed.length < RESPONSE.length && step >= 5;
  const busy = step >= 1 && step <= 7;

  return (
    <MockFrame
      title="Asistente"
      badge={
        <Badge variant="agent" className="text-[10px]">
          Delegado
        </Badge>
      }
    >
      <div className="space-y-3">
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

        {/* Bottom-anchored transcript, chat-style: empty space sits above the
            messages as history room. Fixed height (not min-h) sized to the
            settled turn at each band — measured extent 339px at 320w and 267px
            at ≥640w, plus headroom. Too short and the question scrolls off the
            top, leaving an answer with no visible question. */}
        <div className="flex h-[23rem] flex-col justify-end gap-2 overflow-hidden sm:h-[18.5rem]">
          <m.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-[11px] text-primary-foreground"
          >
            {QUESTION}
          </m.div>

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

          {step >= 2 ? (
            <div
              className={cn(
                "max-w-[94%] space-y-1.5 rounded-lg rounded-bl-sm border border-border/60 px-3 py-2",
                busy ? "bg-gradient-to-r from-agent/5 to-transparent" : "bg-card",
              )}
            >
              <m.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                <ToolPill
                  icon={ListChecksIcon}
                  state={step >= 3 ? "done" : "inflight"}
                  pending="Consultando su registro de cumplimiento…"
                  finished="Se consultó su registro de cumplimiento"
                />
              </m.div>

              {step >= 3 ? (
                <m.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                  <ToolPill
                    icon={FileSearchIcon}
                    state={step >= 4 ? "done" : "inflight"}
                    pending="Revisando un documento…"
                    finished="Se revisó un documento"
                  />
                </m.div>
              ) : null}

              {step >= 4 ? (
                <m.button
                  type="button"
                  tabIndex={-1}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
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

              {step >= 5 ? (
                <p className="text-[11px] leading-relaxed">
                  {streamed}
                  {typing ? <Caret /> : null}
                </p>
              ) : null}

              {step >= 6 ? (
                <m.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                  <ToolPill
                    icon={LightbulbIcon}
                    state={step >= 7 ? "done" : "inflight"}
                    pending="Tomando nota…"
                    finished="Anotado para la próxima vez"
                  />
                </m.div>
              ) : null}

              {step >= 7 ? (
                <m.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                  <ToolPill
                    icon={FileSignatureIcon}
                    state={step >= 8 ? "done" : "inflight"}
                    pending="Redactando una propuesta de directiva…"
                    finished="Propuesta enviada a revisión"
                  />
                </m.div>
              ) : null}
            </div>
          ) : null}
        </div>

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

        {/* The other side of the same event: policy-builder.tsx's proposal
            card. Reserved (measured 149px at 320w, 119px at ≥640w) so the
            frame does not grow when the last beat lands. */}
        <div className="min-h-[10rem] sm:min-h-[8rem]">
          <AnimatePresence>
            {step >= 8 ? (
              <m.div
                key="console"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.24 }}
                className="rounded-md border border-agent/25 bg-agent/5 p-2.5"
              >
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  La misma propuesta, ya en la consola de gobernanza
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-agent">
                  <BotIcon className="h-3 w-3 shrink-0" />
                  Propuestas del asistente
                  <Badge variant="warning" className="text-[8px]">
                    Pendiente
                  </Badge>
                </p>
                <p className="mt-1 text-[10px] leading-relaxed">
                  Validaciones de Contrato marco de servicios firmado: quitar El documento está
                  firmado.
                </p>
                <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                  Motivo del proveedor: “Firmamos con firma electrónica.”
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="rounded-md bg-primary px-2 py-0.5 text-[9px] font-medium text-primary-foreground">
                    Aprobar…
                  </span>
                  <span className="rounded-md border border-input bg-card px-2 py-0.5 text-[9px] font-medium">
                    Rechazar…
                  </span>
                </div>
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </MockFrame>
  );
}
