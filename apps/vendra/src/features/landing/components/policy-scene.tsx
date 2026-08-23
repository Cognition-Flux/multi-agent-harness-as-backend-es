"use client";

/**
 * Animated miniature of the superadmin governance console: the draft is
 * validated against the OPA admissibility gate (verbatim finding
 * translations), the activation dialog confirms consequences and re-pins
 * existing vendors, and the version history updates. Last scene = settled.
 */

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CheckIcon,
  LockIcon,
  UserCheckIcon,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";

import { Badge } from "@/components/ui/primitives";

import { useSceneLoop } from "../motion";
import { MockFrame, MockSpinner } from "./mock-frame";

const DURATIONS = [2000, 1600, 2800, 2800, 5200] as const;
// 0: draft dirty · 1: validando · 2: gate result · 3: activate dialog · 4: v4 activa

export function PolicyScene() {
  const step = useSceneLoop(DURATIONS);
  const activated = step === 4;

  return (
    <MockFrame
      title="Plataforma · Acme Constructora SpA"
      badge={
        <AnimatePresence mode="wait" initial={false}>
          <m.span
            key={activated ? "v4" : "v3"}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
          >
            <Badge variant={activated ? "success" : "secondary"} className="text-[10px]">
              {activated ? "v4 activa" : "v3 activa"}
            </Badge>
          </m.span>
        </AnimatePresence>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {activated ? (
            <Badge variant="muted" className="text-[10px]">v3 archivada</Badge>
          ) : (
            <Badge variant="warning" className="text-[10px]">Borrador v4 sin activar</Badge>
          )}
          <Badge variant="muted" className="text-[10px]">
            {activated ? "12 proveedores anclados a v4" : "12 proveedores anclados a v3"}
          </Badge>
        </div>

        <div className="rounded-md border border-border/60 bg-card p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <UserCheckIcon className="h-3.5 w-3.5 text-agent" /> Aprobación automática
          </p>
          <ul className="mt-2 space-y-1.5">
            <li className="flex items-center justify-between gap-2 text-[11px]">
              <span>Identidad fiscal</span>
              <span className="flex items-center gap-1 font-medium text-warning">
                <LockIcon className="h-3 w-3" /> Un oficial debe aprobarla
              </span>
            </li>
            <li className="flex items-center justify-between gap-2 text-[11px]">
              <span>Seguro de responsabilidad civil general</span>
              <span className="flex items-center gap-1 font-medium text-success">
                <CheckCircle2Icon className="h-3 w-3" /> El sistema decide
              </span>
            </li>
            <li className="flex items-center justify-between gap-2 text-[11px]">
              <span>Licencia comercial</span>
              <span className="flex items-center gap-1 font-medium text-success">
                <CheckCircle2Icon className="h-3 w-3" /> El sistema decide
              </span>
            </li>
          </ul>
        </div>

        {/* Action theater: sticky bar → gate → dialog → success banner.
            Reserved to the tallest step per breakpoint (measured: 165px at
            320w, 138px at ≥640w) so cycling never shifts the layout. */}
        <div className="relative min-h-[11rem] sm:min-h-[9.5rem]">
          <AnimatePresence mode="wait" initial={false}>
            {step <= 1 ? (
              <m.div
                key="bar"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-card px-2.5 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1 text-[10px] font-medium">
                      {step === 1 ? <MockSpinner /> : null}
                      Validar
                    </span>
                    <span className="rounded-md border border-input bg-card px-2 py-1 text-[10px] font-medium">
                      Guardar borrador
                    </span>
                    <span className="hidden rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground sm:inline">
                      Activar política…
                    </span>
                  </div>
                  <span className="text-[9px] text-muted-foreground">
                    {step === 1 ? "Borrador v4 sin activar" : "Cambios sin guardar"}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  La puerta de admisibilidad OPA (Rego compilado a Wasm) se evalúa localmente —
                  antes de activar cualquier política.
                </p>
              </m.div>
            ) : null}

            {step === 2 ? (
              <m.div
                key="gate"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                className="rounded-md border border-success/25 bg-success/5 p-3"
              >
                {/* Admissible-with-warnings: the real gate card keeps the
                    success border + check here — warnings never block. */}
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-success">
                  <CheckIcon className="h-3.5 w-3.5" /> Advertencias de esta configuración
                </p>
                <m.p
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 }}
                  className="mt-1.5 flex items-start gap-1.5 text-[10px] text-muted-foreground"
                >
                  <AlertTriangleIcon className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  Identidad fiscal es obligatorio y requerirá la decisión de un oficial en cada
                  proveedor.
                </m.p>
                <m.p
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 }}
                  className="mt-1 flex items-start gap-1.5 text-[10px] text-muted-foreground"
                >
                  <AlertTriangleIcon className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  Certificado de seguro (ACORD 25) ejecuta 3 de 5 validaciones disponibles.
                </m.p>
              </m.div>
            ) : null}

            {step === 3 ? (
              <m.div
                key="dialog"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
                className="rounded-md border border-border/60 bg-card p-3 shadow-lift"
              >
                <p className="text-[11px] font-semibold">Activar la política v4</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Acme Constructora SpA aceptará 4 tipo(s) de documento. Aprueba el sistema (2) ·
                  Requiere un oficial (1).
                </p>
                <label className="mt-2 flex items-center gap-1.5 text-[10px]">
                  <span className="flex h-3 w-3 items-center justify-center rounded-sm border border-agent bg-agent/10">
                    <CheckIcon className="h-2.5 w-2.5 text-agent" />
                  </span>
                  Aplicar también a los 12 proveedor(es) existentes
                </label>
                <div className="mt-2 flex justify-end gap-1.5">
                  <span className="rounded-md border border-input bg-card px-2.5 py-1 text-[10px] font-medium">
                    Cancelar
                  </span>
                  <span className="rounded-md bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground">
                    Activar
                  </span>
                </div>
              </m.div>
            ) : null}

            {step === 4 ? (
              <m.div
                key="done"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                className="space-y-2"
              >
                <div className="rounded-md border border-success/25 bg-success/10 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-[10px] font-medium text-success">
                    <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0" />
                    Política v4 activada y aplicada a 12 proveedor(es) existente(s).
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-card px-3 py-2">
                  <p className="text-[10px] font-semibold">Historial</p>
                  <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Badge variant="success" className="text-[8px]">v4</Badge> activa desde 23 ago 2026
                    <Badge variant="muted" className="text-[8px]">v3</Badge> archivada
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5">
                  <p className="min-w-0 truncate text-[10px]">
                    <span className="font-semibold text-warning">Propuestas del asistente:</span>{" "}
                    Aceptar: Póliza umbrella / de exceso de responsabilidad — Pendiente
                  </p>
                  <span className="shrink-0 rounded-md border border-input bg-card px-2 py-0.5 text-[9px] font-medium">
                    Aprobar…
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
