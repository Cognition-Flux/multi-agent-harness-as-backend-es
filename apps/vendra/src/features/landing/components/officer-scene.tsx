"use client";

/**
 * Animated miniature of the officer dashboard: a vendor referred to human
 * review ("Esperando su decisión…") gets a manual grant through the real
 * dialog ("Otorgar requisito manualmente"), the roster badge flips to
 * Aprobado and the audit trail appends the transition. All copy is verbatim
 * from mutation-dialogs.tsx / vendor-detail.tsx. Last scene = settled state.
 */

import { CheckIcon, ClockIcon, SearchIcon, UserCheckIcon } from "lucide-react";
import { AnimatePresence, m } from "motion/react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

import { useSceneLoop } from "../motion";
import { MockFrame, MockSpinner, STACK } from "./mock-frame";

/** Shared roster track template — header and rows must resolve identically. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-2 px-2.5 sm:grid-cols-[minmax(0,1fr)_6.5rem_5rem_7.5rem]";

const DURATIONS = [1100, 1400, 1600, 3000] as const;

// step 0: base roster · 1: referred copy · 2: grant dialog · 3: approved + audit

export function OfficerScene() {
  const step = useSceneLoop(DURATIONS);
  const granted = step === 3;

  return (
    <MockFrame
      title="Cumplimiento de proveedores"
      badge={<Badge variant="secondary" className="text-[10px]">Oficial</Badge>}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 flex-1 items-center gap-1.5 rounded-md border border-input bg-card px-2 text-[11px] text-muted-foreground">
            <SearchIcon className="h-3 w-3" /> Buscar proveedores…
          </div>
          <span className="hidden rounded-md border border-input bg-card px-2 py-1 text-[10px] text-muted-foreground sm:block">
            Todos los estados
          </span>
          <span className="hidden rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] font-medium text-warning md:block">
            Por vencer dentro de 30 días
          </span>
        </div>

        {/* Ordered next-expiry-first, like the real roster. Below sm only the
            first two columns render, so the 1fr track stays legible. */}
        <div className="overflow-hidden rounded-md border border-border/60">
          <div className={cn(ROW_GRID, "border-b border-border/60 bg-muted/60 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground")}>
            <span className="truncate">Proveedor</span>
            <span className="truncate">Estado</span>
            <span className="hidden truncate sm:block">Otorgadas</span>
            <span className="hidden truncate text-right sm:block">Próximo vencimiento</span>
          </div>

          {/* The row being adjudicated. */}
          <m.div
            animate={{
              backgroundColor:
                step === 1 || step === 2 ? "hsl(35 90% 30% / 0.06)" : "hsl(0 0% 100% / 0)",
            }}
            transition={{ duration: 0.25 }}
            className={cn(ROW_GRID, "border-b border-border/40 bg-card py-2")}
          >
            <span className="truncate text-[11px] font-medium">Beta Logística Ltda.</span>
            {/* Stays "Requiere revisión": a manual grant never writes an
                approval transition — only the officer's finalize does. */}
            <Badge variant="warning" className="text-[10px]">Requiere revisión</Badge>
            <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
              {granted ? "11 categorías" : "10 categorías"}
            </span>
            <span className="hidden text-right text-[11px] tabular-nums text-muted-foreground sm:block">
              3 oct 2026
            </span>
          </m.div>

          <div className={cn(ROW_GRID, "border-b border-border/40 bg-card py-2")}>
            <span className="truncate text-[11px] font-medium">Acme Constructora SpA</span>
            <Badge variant="success" className="text-[10px]">Aprobado</Badge>
            <span className="hidden truncate text-[11px] text-muted-foreground sm:block">11 categorías</span>
            <span className="hidden text-right text-[11px] tabular-nums text-muted-foreground sm:block">
              12 may 2027
            </span>
          </div>

          <div className={cn(ROW_GRID, "bg-card py-2")}>
            <span className="truncate text-[11px] font-medium">Gamma Servicios SA</span>
            <Badge variant="agent" dot className="[&>span]:animate-pulse text-[10px]">
              En progreso
            </Badge>
            <span className="hidden truncate text-[11px] text-muted-foreground sm:block">4 categorías</span>
            <span className="hidden text-right text-[11px] tabular-nums text-muted-foreground sm:block">
              —
            </span>
          </div>
        </div>

        {/* Action theater: referred copy → grant dialog → audit trail.
            Reserved to the tallest step per breakpoint (measured: 187px at
            320w, 158px at ≥640w) so cycling never shifts the layout. */}
        <div className={cn(STACK, "min-h-[12.5rem] sm:min-h-[10.5rem]")}>
          <AnimatePresence initial={false}>
            {step === 0 ? (
              <m.div
                key="toolkit"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.1 } }}
                className="space-y-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Verbatim DocRow action labels — "Revocar" carries no
                      ellipsis in the product; the other four do. */}
                  {["Eximir…", "Recategorizar…", "Otorgar manualmente…", "Revocar", "Reintentar procesamiento"].map(
                    (a) => (
                      <span
                        key={a}
                        className="rounded-md border border-input bg-card px-2 py-1 text-[10px] font-medium"
                      >
                        {a}
                      </span>
                    ),
                  )}
                </div>
                <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <ClockIcon className="h-3 w-3" />
                  Trazabilidad de requisitos: qué documento otorga cada categoría y por qué regla.
                </p>
              </m.div>
            ) : null}

            {step === 1 ? (
              <m.div
                key="referred"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.1 } }}
                className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5"
              >
                <p className="text-[10px] leading-relaxed text-warning">
                  <span className="font-semibold">⏳ Seguro de responsabilidad civil general — Esperando su decisión:</span>{" "}
                  la documentación respalda este requisito, pero la política de la empresa no permite
                  que el sistema lo apruebe. Use «Otorgar manualmente…».
                </p>
              </m.div>
            ) : null}

            {step === 2 ? (
              <m.div
                key="dialog"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
                className="rounded-md border border-border/60 bg-card p-3 shadow-lift"
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <UserCheckIcon className="h-3.5 w-3.5 text-agent" /> Otorgar requisito manualmente
                </p>
                <div className="mt-2 space-y-1.5">
                  <div className="flex h-6 items-center rounded border border-input bg-card px-2 text-[10px]">
                    Seguro de responsabilidad civil general
                  </div>
                  <div className="rounded border border-input bg-card px-2 py-1.5 text-[10px] text-muted-foreground">
                    Verifiqué la póliza directamente con la aseguradora por teléfono…
                  </div>
                  <p className="text-[9px] text-muted-foreground">
                    Justificación (10–1000 caracteres) — la justificación queda en el registro de auditoría.
                  </p>
                  <div className="flex justify-end">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground">
                      <MockSpinner className="border-primary-foreground/60 border-t-transparent" />
                      Otorgando…
                    </span>
                  </div>
                </div>
              </m.div>
            ) : null}

            {step === 3 ? (
              <m.div
                key="audit"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.1 } }}
                className="space-y-1.5 rounded-md border border-border/60 bg-card p-3"
              >
                <p className="text-[11px] font-semibold">Actividad</p>
                <m.p
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.14, duration: 0.22 }}
                  className="flex items-center gap-1.5 text-[10px]"
                >
                  <CheckIcon className="h-3 w-3 shrink-0 text-success" />
                  <span className="tabular-nums text-muted-foreground">23 ago 2026</span>
                  <span className="font-medium">requisito otorgado manualmente</span>
                  <Badge variant="outline" className="text-[8px]">CONCESIÓN MANUAL</Badge>
                </m.p>
                {/* A grant recomputes coverage and closes the category; the
                    final APROBADO is a separate, explicit officer decision on
                    the "Finalizar estado de cumplimiento" card. */}
                <m.p
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3, duration: 0.22 }}
                  className="text-[10px] text-muted-foreground"
                >
                  11 de 11 categorías otorgadas — listo para finalizar el estado.
                </m.p>
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </MockFrame>
  );
}
