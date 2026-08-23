"use client";

/**
 * Animated miniature of the vendor portal: one document advances through the
 * real pipeline stages (verbatim STAGE_MESSAGES) while the requirement aside
 * reacts — the coverage row resolves and the activation gate count drops.
 * Last scene = settled state (reduced-motion visitors land there).
 */

import { CheckIcon, CircleIcon, FileTextIcon, UploadCloudIcon } from "lucide-react";
import { AnimatePresence, m } from "motion/react";

import { Badge } from "@/components/ui/primitives";

import { useSceneLoop } from "../motion";
import { cn } from "@/lib/utils";

import { MiniProgress, MockFrame, MockSpinner, STACK } from "./mock-frame";

/** Verbatim STAGE_MESSAGES entries (extracting, validating, mapping). */
const STAGES = [
  { n: 4, msg: "Leyendo y extrayendo la información clave..." },
  { n: 6, msg: "Verificando que toda la información requerida esté presente..." },
  { n: 8, msg: "Vinculando este documento con sus requisitos de cumplimiento..." },
] as const;

const DURATIONS = [1300, 1300, 1300, 2900] as const;
const VERIFIED_STEP = DURATIONS.length - 1;

export function PortalScene() {
  const step = useSceneLoop(DURATIONS);
  const verified = step === VERIFIED_STEP;
  const stage = STAGES[Math.min(step, STAGES.length - 1)];

  return (
    <MockFrame
      title="Incorporación y cumplimiento de proveedores"
      badge={
        <Badge variant="info" dot className="[&>span]:animate-pulse text-[10px]">
          En progreso
        </Badge>
      }
    >
      {/* min-w-0 on both children: without it the auto track cannot shrink
          below the aside's min-content and the scene is clipped by the frame
          on narrow phones. */}
      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-agent/40 bg-agent/5 px-3 py-4 text-center">
            <UploadCloudIcon className="h-4 w-4 text-agent" />
            <p className="text-xs font-medium">Arrastre los archivos aquí o haga clic para subirlos</p>
            <p className="text-[10px] text-muted-foreground">PNG, JPEG, WebP o PDF · hasta 10 MB</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium">w9-acme.pdf</span>
              </div>
              <Badge variant="success" className="text-[10px]">Verificado</Badge>
            </div>

            {/* The live card: stages advance, then it settles verified. */}
            <div
              className={
                verified
                  ? "rounded-md border border-success/25 bg-card px-2.5 py-2"
                  : "rounded-md border border-agent/25 bg-card px-2.5 py-2 shadow-glow"
              }
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FileTextIcon className={`h-3.5 w-3.5 shrink-0 ${verified ? "text-success" : "text-agent"}`} />
                  <span className="truncate text-xs font-medium">coi-acord25.pdf</span>
                </div>
                {verified ? (
                  <Badge variant="success" className="text-[10px]">Verificado</Badge>
                ) : (
                  <Badge variant="agent" dot className="[&>span]:animate-pulse text-[10px]">
                    Procesando
                  </Badge>
                )}
              </div>
              {/* Reserved to the tallest stage line (measured 30px — the longest
                  message wraps to two lines in the wide column). */}
              <div className={cn(STACK, "mt-1.5 min-h-[2rem]")}>
                <AnimatePresence initial={false}>
                  <m.p
                    key={verified ? "ok" : stage.n}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4, transition: { duration: 0.09 } }}
                    transition={{ duration: 0.2 }}
                    className={`text-[10px] italic ${verified ? "text-success" : "text-muted-foreground"}`}
                  >
                    {verified
                      ? "Acredita: Seguro de responsabilidad civil general"
                      : `${stage.msg} · Etapa ${stage.n} de 8`}
                  </m.p>
                </AnimatePresence>
              </div>
              <div className="mt-1">
                <MiniProgress
                  pct={(verified ? 8 : stage.n) * 12.5}
                  className={verified ? "from-success to-success" : undefined}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium">licencia-municipal.pdf</span>
              </div>
              <Badge variant="muted" className="text-[10px]">En cola</Badge>
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-2 rounded-md border border-border/60 bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Requisitos de cumplimiento</p>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {verified ? "9 de 11" : "8 de 11"}
            </span>
          </div>
          <MiniProgress pct={verified ? 82 : 73} className="from-success to-success" />
          <ul className="space-y-1.5 pt-1">
            <li className="flex items-center gap-1.5 text-[11px]">
              <CheckIcon className="h-3 w-3 text-success" /> Identidad fiscal
            </li>
            <li className="flex min-h-4 items-center gap-1.5 text-[11px]">
              {verified ? (
                <CheckIcon className="h-3 w-3 shrink-0 text-success" />
              ) : (
                <MockSpinner className="h-3 w-3" />
              )}
              <span className="truncate">Seguro de responsabilidad civil general</span>
              {!verified ? (
                <span className="shrink-0 text-[9px] text-muted-foreground">· Revisando cobertura…</span>
              ) : null}
            </li>
            <li className="flex items-center gap-1.5 text-[11px]">
              <CheckIcon className="h-3 w-3 text-success" /> Licencia comercial
            </li>
            <li className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CircleIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">Seguro de compensación laboral</span>
              <span className="shrink-0 rounded-full border border-dashed border-muted-foreground/40 px-1.5 text-[9px]">
                No aplica
              </span>
            </li>
          </ul>
          {/* While the gate is uncleared the button's own label IS the count —
              "Activar cuenta de proveedor" appears only once it clears. */}
          <div className="rounded-md bg-primary/90 px-2.5 py-1.5 text-center text-[11px] font-medium text-primary-foreground opacity-70">
            {verified ? "2 categorías de requisitos restantes" : "3 categorías de requisitos restantes"}
          </div>
          <p className="text-center text-[9px] text-muted-foreground">
            {verified
              ? "Suba documentos que cubran los requisitos restantes."
              : "Esperando a que termine la revisión de cobertura…"}
          </p>
        </div>
      </div>
    </MockFrame>
  );
}
