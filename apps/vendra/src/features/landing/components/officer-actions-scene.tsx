"use client";

/**
 * The officer's rescue toolkit, one action per beat: waive, re-categorize,
 * grant, revoke, retry — each opening the real dialog from
 * mutation-dialogs.tsx and appending its own line to the Actividad ledger
 * (ACTIVITY_LABELS in vendor-detail.tsx). The settled beat shows the full
 * ledger next to "Finalizar estado de cumplimiento", because the final state
 * is a separate, explicit decision — a grant never writes an approval.
 *
 * The five actions are five demonstrations on the same vendor's file, not a
 * causal chain; the document row above the toolkit says which file each one
 * is acting on.
 */

import {
  BanIcon,
  CheckIcon,
  FileTextIcon,
  RefreshCwIcon,
  ReplaceIcon,
  ShieldOffIcon,
  UserCheckIcon,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

import { useSceneLoop } from "../motion";
import { MockFrame, MockSpinner, STACK } from "./mock-frame";

const DURATIONS = [900, 1500, 1500, 1500, 1500, 1200, 3400] as const;
// 0 kit completo · 1 eximir · 2 recategorizar · 3 otorgar · 4 revocar
// 5 reintentar · 6 registro completo + finalizar (asentado)
const SETTLED = DURATIONS.length - 1;

/** Button labels are verbatim from vendor-detail.tsx's DocRow action row. */
const ACTIONS = [
  {
    icon: ShieldOffIcon,
    button: "Eximir…",
    file: "coi-filial.pdf",
    type: "Certificado de seguro (ACORD 25)",
    activity: "documento eximido",
  },
  {
    icon: ReplaceIcon,
    button: "Recategorizar…",
    file: "nda-firmado.pdf",
    type: "Acuerdo de confidencialidad firmado",
    activity: "documento recategorizado",
  },
  {
    icon: UserCheckIcon,
    button: "Otorgar manualmente…",
    file: "coi-acord25.pdf",
    type: "Certificado de seguro (ACORD 25)",
    activity: "requisito otorgado manualmente",
  },
  {
    icon: BanIcon,
    button: "Revocar",
    file: "coi-acord25.pdf",
    type: "Certificado de seguro (ACORD 25)",
    activity: "concesión manual revocada",
  },
  {
    icon: RefreshCwIcon,
    button: "Reintentar procesamiento",
    file: "licencia-municipal.pdf",
    type: "Licencia comercial",
    activity: "reintento solicitado",
  },
] as const;

/** Dialog chrome shared by the four dialog beats. */
function DialogShell({
  title,
  destructive,
  children,
}: {
  title: string;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <m.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
      transition={{ duration: 0.2 }}
      className={cn(
        "rounded-md border bg-card p-2.5 shadow-lift",
        destructive ? "border-destructive/30" : "border-border/60",
      )}
    >
      <p className="text-[11px] font-semibold">{title}</p>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </m.div>
  );
}

function Justification({ chars, placeholder }: { chars: string; placeholder?: boolean }) {
  return (
    <>
      <div className="rounded border border-input bg-card px-2 py-1.5 text-[10px] text-muted-foreground">
        {placeholder
          ? "¿Por qué es aceptable? Esto queda en el registro de auditoría."
          : "Verifiqué la póliza directamente con la aseguradora por teléfono…"}
      </div>
      <p className="text-[9px] text-muted-foreground">{chars}</p>
    </>
  );
}

function PendingButton({ label, destructive }: { label: string; destructive?: boolean }) {
  return (
    <div className="flex justify-end">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium text-primary-foreground",
          destructive ? "bg-destructive" : "bg-primary",
        )}
      >
        <MockSpinner className="border-primary-foreground/60 border-t-transparent" />
        {label}
      </span>
    </div>
  );
}

export function OfficerActionsScene() {
  const step = useSceneLoop(DURATIONS);
  const settled = step === SETTLED;
  const active = step >= 1 && step <= 5 ? ACTIONS[step - 1] : null;
  const doc = active ?? ACTIONS[ACTIONS.length - 1];

  return (
    <MockFrame
      title="Beta Logística Ltda."
      badge={
        <Badge variant="warning" className="text-[10px]">
          Requiere revisión
        </Badge>
      }
    >
      <div className="space-y-3">
        {/* Detail tabs, verbatim TAB_LABELS. */}
        <div className="flex items-center gap-3 border-b border-border/60 pb-1.5 text-[10px]">
          <span className="text-muted-foreground">Resumen</span>
          <span className="relative font-medium text-primary">
            Documentos
            <span aria-hidden className="absolute inset-x-0 -bottom-1.5 h-0.5 rounded-full bg-primary" />
          </span>
          <span className="truncate text-muted-foreground">Trazabilidad de requisitos</span>
        </div>

        {/* The row being acted on — the file changes with the beat. */}
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/80 bg-card px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              {/* Only the filename swaps; the type line below must not be
                  stacked with it, so the STACK wrapper is scoped to it. */}
              <div className={STACK}>
                <AnimatePresence initial={false}>
                  <m.p
                    key={doc.file}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.09 } }}
                    transition={{ duration: 0.18 }}
                    className="truncate text-[11px] font-medium"
                  >
                    {doc.file}
                  </m.p>
                </AnimatePresence>
              </div>
              <p className="truncate text-[9px] text-muted-foreground">{doc.type}</p>
            </div>
          </div>
          <Badge variant="success" className="shrink-0 text-[9px]">
            Verificado
          </Badge>
        </div>

        {/* The toolkit: the active action lifts, the rest stay available. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {ACTIONS.map((a, i) => {
            const on = step === i + 1;
            return (
              <span
                key={a.button}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors duration-200",
                  on
                    ? "border-agent/40 bg-agent/10 text-agent shadow-glow"
                    : "border-input bg-card text-foreground",
                )}
              >
                <a.icon className="h-3 w-3 shrink-0" />
                {a.button}
              </span>
            );
          })}
        </div>

        {/* Action theater. Reserved to the tallest beat per band (measured:
            217px at 320w, 171px at 390–430w, 157px at ≥640w) — the waive
            dialog is the tallest, the finalize card the widest. The middle
            band is worth its own step: a flat 320w reserve leaves 60px of dead
            space on the most common phone widths. */}
        <div className={cn(STACK, "min-h-[14.5rem] min-[380px]:min-h-[12rem] sm:min-h-[10.5rem]")}>
          <AnimatePresence initial={false}>
            {step === 0 ? (
              <m.div
                key="idle"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5, transition: { duration: 0.1 } }}
                transition={{ duration: 0.2 }}
                className="rounded-md border border-border/60 bg-card p-2.5"
              >
                <p className="text-[11px] font-semibold">Trazabilidad de requisitos</p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Cada categoría muestra qué documento la otorga y por qué regla. Cuando el motor
                  determinista se detiene, estas cinco acciones lo destraban — y ninguna se ejecuta
                  sin justificación escrita.
                </p>
              </m.div>
            ) : null}

            {step === 1 ? (
              <DialogShell key="waive" title="Eximir de la validación">
                <p className="rounded bg-muted/50 px-2 py-1.5 text-[9px] leading-relaxed text-muted-foreground">
                  Otorgue SOLO las categorías que esta falla bloquea legítimamente…
                </p>
                <p className="flex items-center gap-1.5 text-[10px]">
                  <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border border-agent bg-agent/10">
                    <CheckIcon className="h-2.5 w-2.5 text-agent" />
                  </span>
                  Identidad fiscal
                </p>
                <p className="text-[9px] text-muted-foreground">
                  Vencimiento de la exención: 21 nov 2026
                </p>
                <PendingButton label="Aplicando…" />
              </DialogShell>
            ) : null}

            {step === 2 ? (
              <DialogShell key="reclass" title="Recategorizar documento">
                <p className="rounded bg-muted/50 px-2 py-1.5 text-[9px] leading-relaxed text-muted-foreground">
                  Vuelve a ejecutar la validación y el mapeo de requisitos sobre la extracción
                  trasladada bajo el nuevo tipo…
                </p>
                <div className="flex h-6 items-center rounded border border-input bg-card px-2 text-[10px]">
                  Contrato marco de servicios firmado
                </div>
                <p className="text-[9px] text-muted-foreground">
                  Justificación (10–500 caracteres)
                </p>
                <PendingButton label="Recategorizando…" />
              </DialogShell>
            ) : null}

            {step === 3 ? (
              <DialogShell key="grant" title="Otorgar requisito manualmente">
                <div className="flex h-6 items-center rounded border border-input bg-card px-2 text-[10px]">
                  Seguro de responsabilidad civil general
                </div>
                <Justification chars="Justificación (10–1000 caracteres)" />
                <PendingButton label="Otorgando…" />
              </DialogShell>
            ) : null}

            {step === 4 ? (
              <DialogShell key="revoke" title="Revocar Seguro de responsabilidad civil general" destructive>
                <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[9px] leading-relaxed text-destructive">
                  Revocar elimina esta categoría otorgada manualmente — la cobertura se recalcula de
                  inmediato.
                </p>
                <Justification chars="Justificación (10–1000 caracteres)" placeholder />
                <PendingButton label="Revocando…" destructive />
              </DialogShell>
            ) : null}

            {step === 5 ? (
              <m.div
                key="retry"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5, transition: { duration: 0.1 } }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-2 rounded-md border border-agent/25 bg-agent/5 px-2.5 py-2"
              >
                <MockSpinner />
                <p className="text-[10px] leading-relaxed">
                  Reintentar procesamiento vuelve a lanzar la sesión del agente sobre el mismo
                  archivo — sin volver a subirlo y sin perder el historial.
                </p>
              </m.div>
            ) : null}

            {settled ? (
              <m.div
                key="finalize"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5, transition: { duration: 0.1 } }}
                transition={{ duration: 0.2 }}
                className="rounded-md border border-border/60 bg-card p-2.5"
              >
                <p className="text-[11px] font-semibold">Finalizar estado de cumplimiento</p>
                <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground">
                  APROBADO habilita la acción de sincronización con el ERP (explícita, nunca
                  automática).
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="rounded-md border border-input bg-card px-2 py-1 text-[9px] font-medium">
                    Probablemente en cumplimiento
                  </span>
                  <span className="rounded-md border border-input bg-card px-2 py-1 text-[9px] font-medium">
                    Requiere revisión
                  </span>
                  <span className="rounded-md bg-success px-2 py-1 text-[9px] font-medium text-success-foreground">
                    Aprobado
                  </span>
                  <span className="rounded-md bg-destructive px-2 py-1 text-[9px] font-medium text-destructive-foreground">
                    Rechazado
                  </span>
                </div>
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Ledger: append-only, one line per action, revealed as its beat
            completes. Rows that have not happened yet are `invisible` rather
            than dimmed — small text at a low opacity drops under AA (and the
            row is not yet true anyway). All five slots are always laid out, so
            the frame height never moves. */}
        <div className="space-y-1 rounded-md border border-border/60 bg-card px-2.5 py-2">
          <p className="text-[10px] font-semibold">Actividad</p>
          {ACTIONS.map((a, i) => {
            const done = settled || step > i + 1;
            return (
              <p
                key={a.activity}
                className={cn(
                  "flex items-center gap-1.5 text-[10px] transition-opacity duration-200",
                  done ? "opacity-100" : "invisible opacity-0",
                )}
              >
                <CheckIcon className="h-3 w-3 shrink-0 text-success" />
                <span className="tabular-nums text-muted-foreground">23 ago 2026</span>
                <span className="truncate font-medium">{a.activity}</span>
              </p>
            );
          })}
        </div>
      </div>
    </MockFrame>
  );
}
