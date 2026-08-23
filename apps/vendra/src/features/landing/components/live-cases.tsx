"use client";

/**
 * "Casos en vivo": four self-running demos of the platform's hard cases —
 * umbrella-policy coverage stacking, a scoped failure rescued by an officer
 * waiver, automatic expiry + renewal restore, and a human-in-the-loop
 * confirmation with its draining countdown. Copy is
 * verbatim from the real surfaces (coverage stage copy, transition audit
 * format, HITL footer). Each card loops on its own cadence; the last scene
 * of each is the settled state for reduced-motion visitors.
 */

import { CheckCircle2Icon, ClockIcon, FileTextIcon, XCircleIcon } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

import { Stagger, StaggerItem, useSceneLoop } from "../motion";
import { MockShimmerText, MockSpinner, STACK } from "./mock-frame";
import { SectionHeading } from "./section-heading";

function CaseCard({
  file,
  srFile,
  type,
  pill,
  footer,
  children,
}: {
  file: string;
  /** Stable name for AT when `file` itself animates — keeps the accessibility
   *  tree from mutating on the scene loop. */
  srFile?: string;
  type: string;
  pill: ReactNode;
  /** Accessible one-liner: the animated demo above it is decorative. */
  footer: string;
  children: ReactNode;
}) {
  return (
    <div className="glass flex h-full select-none flex-col rounded-lg p-4 shadow-soft transition-shadow duration-300 hover:shadow-lift">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-agent/10">
            <FileTextIcon className="h-4 w-4 text-agent" />
          </span>
          <div className="min-w-0">
            {srFile ? <span className="sr-only">{srFile}</span> : null}
            <p aria-hidden={srFile ? true : undefined} className="truncate text-sm font-medium">
              {file}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">{type}</p>
          </div>
        </div>
        <div aria-hidden className="shrink-0">{pill}</div>
      </div>
      <div aria-hidden className="mt-3 flex-1">{children}</div>
      <p className="mt-3 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
        {footer}
      </p>
    </div>
  );
}

// ── Caso 1 · Apilamiento de cobertura ───────────────────────────────────────

const STACK_DURATIONS = [1400, 1500, 3100] as const;

function CoverageStackCase() {
  const step = useSceneLoop(STACK_DURATIONS);
  const stacked = step >= 1;
  const done = step === 2;

  return (
    <CaseCard
      file="poliza-umbrella.pdf"
      type="Póliza umbrella / de exceso de responsabilidad"
      footer="Apilamiento de cobertura: el host re-deriva cada cifra — un payload incoherente rebota al agente antes de persistir."
      pill={
        done ? (
          <Badge variant="success" className="text-[10px]">Verificado</Badge>
        ) : (
          <Badge variant="agent" dot className="[&>span]:animate-pulse text-[10px]">
            Procesando
          </Badge>
        )
      }
    >
      <div className="flex h-full flex-col justify-between gap-3">
        <div className={cn(STACK, "min-h-8")}>
          <AnimatePresence initial={false}>
            {done ? (
              <m.p
                key="v"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="flex items-center gap-1.5 text-xs font-medium text-success"
              >
                <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0" />
                Cumple el requisito — primaria + umbrella
              </m.p>
            ) : (
              <m.p
                key="p"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="text-xs italic text-muted-foreground"
              >
                Verificando límites y acumulación de pólizas umbrella…
              </m.p>
            )}
          </AnimatePresence>
        </div>

        <div>
          <div className="flex items-baseline justify-between text-[10px]">
            <span className="font-medium">Responsabilidad civil general</span>
            <span className="tabular-nums text-muted-foreground">
              Requerido: $2.000.000
            </span>
          </div>
          {/* Stacking bar: primary fills half, umbrella stacks the rest. */}
          <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-muted">
            <m.div
              className="h-full bg-agent"
              initial={false}
              animate={{ width: "50%" }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
            <m.div
              className="h-full bg-[hsl(30_90%_45%)]"
              initial={false}
              animate={{ width: stacked ? "50%" : "0%" }}
              transition={{ duration: 0.55, ease: "easeOut", delay: 0.12 }}
            />
          </div>
          <div className="mt-1.5 space-y-1 text-[10px] text-muted-foreground">
            <p className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-agent" /> Póliza primaria
              </span>
              <span className="tabular-nums">$1.000.000</span>
            </p>
            <p className={cn("flex items-center justify-between transition-opacity duration-300", stacked ? "opacity-100" : "opacity-35")}>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[hsl(30_90%_45%)]" /> Umbrella (apilada)
              </span>
              <span className="tabular-nums">$1.000.000</span>
            </p>
            <p className="flex items-center justify-between border-t border-border/60 pt-1 font-medium text-foreground">
              <span>Cobertura efectiva</span>
              <span className="tabular-nums">{stacked ? "$2.000.000" : "$1.000.000"}</span>
            </p>
          </div>
        </div>

      </div>
    </CaseCard>
  );
}

// ── Caso 2 · Vencimiento y renovación ───────────────────────────────────────

const EXPIRY_DURATIONS = [1500, 1600, 1400, 3100] as const;
// 0: aprobado por vencer · 1: barrido → Vencido · 2: renovación procesando · 3: restaurado

function ExpiryRenewalCase() {
  const step = useSceneLoop(EXPIRY_DURATIONS);

  return (
    <CaseCard
      file={step >= 2 ? "licencia-2027.pdf" : "licencia-2026.pdf"}
      srFile="licencia comercial (renovación)"
      type="Licencia comercial"
      footer="Cumplimiento continuo: aviso de renovación a 30 días, la expiración pasa APROBADO→VENCIDO sola y una renovación válida restaura la aprobación."
      pill={
        <span className={STACK}>
        <AnimatePresence initial={false}>
          <m.span
            key={step}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.09 } }}
          >
            {step === 0 ? (
              <Badge variant="success" className="text-[10px]">Verificado</Badge>
            ) : step === 1 ? (
              // EXPIRED rides the warning token with a clock glyph — red is
              // reserved for REJECTED (vendor-status-badge.tsx).
              <Badge variant="warning" className="text-[10px]">
                <ClockIcon className="mr-0.5 h-2.5 w-2.5" /> Vencido
              </Badge>
            ) : step === 2 ? (
              <Badge variant="agent" dot className="[&>span]:animate-pulse text-[10px]">
                Procesando
              </Badge>
            ) : (
              <Badge variant="success" className="text-[10px]">Verificado</Badge>
            )}
          </m.span>
        </AnimatePresence>
        </span>
      }
    >
      <div className="flex h-full flex-col justify-between gap-3">
        {/* Reserved to the tallest step per breakpoint — see HitlCase note. */}
        <div className={cn(STACK, "min-h-[4.25rem] md:min-h-[5.25rem] lg:min-h-[4.25rem] xl:min-h-[3.5rem]")}>
          <AnimatePresence initial={false}>
            {step === 0 ? (
              <m.div
                key="banner"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[10px] leading-relaxed text-warning"
              >
                Su credencial más próxima a vencer expira el 30 ago 2026 — suba una renovación antes
                de esa fecha para mantener el cumplimiento.
              </m.div>
            ) : step === 1 ? (
              <m.div
                key="swept"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-[10px] leading-relaxed"
              >
                <span className="font-medium text-destructive">El tiempo es un disparador:</span>{" "}
                el barrido horario detectó la fecha vencida — nadie tuvo que darse cuenta.
              </m.div>
            ) : step === 2 ? (
              <m.div
                key="renewing"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="flex items-center gap-2 rounded-md border border-agent/25 bg-agent/5 px-2.5 py-2 text-[10px]"
              >
                <MockSpinner />
                <MockShimmerText>Leyendo y extrayendo la información clave...</MockShimmerText>
              </m.div>
            ) : (
              <m.div
                key="restored"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="rounded-md border border-success/25 bg-success/10 px-2.5 py-2 text-[10px] leading-relaxed text-success"
              >
                <CheckCircle2Icon className="mr-1 inline h-3 w-3" />
                Renovación válida — la aprobación se restauró sin intervención del oficial.
              </m.div>
            )}
          </AnimatePresence>
        </div>

        {/* Transition audit, verbatim line format. */}
        <div className="space-y-1 rounded-md border border-border/60 bg-card px-2.5 py-2">
          <p className="text-[10px] font-semibold">Transiciones de estado</p>
          <p className={cn("text-[10px] tabular-nums text-muted-foreground transition-opacity", step >= 1 ? "opacity-100" : "opacity-35")}>
            30 ago 2026: Aprobado → Vencido (barrido automático)
          </p>
          <p className={cn("text-[10px] tabular-nums text-muted-foreground transition-opacity", step >= 3 ? "opacity-100" : "opacity-35")}>
            31 ago 2026: Vencido → Aprobado (sistema)
          </p>
        </div>

      </div>
    </CaseCard>
  );
}

// ── Caso 3 · Humano en el circuito ──────────────────────────────────────────

const HITL_DURATIONS = [1300, 2600, 1100, 3100] as const;
// The 2600ms question beat is mirrored by `animate-drain` in tailwind.config.ts
// (2.6s) — the countdown bar must empty exactly as the beat ends.
// 0: procesando · 1: pregunta + cuenta regresiva · 2: respuesta registrada · 3: verificado

function HitlCase() {
  const step = useSceneLoop(HITL_DURATIONS);
  const done = step === 3;

  return (
    <CaseCard
      file="coi-acord25.pdf"
      type="Certificado de seguro (ACORD 25)"
      footer="Humano en el circuito: ventanas de confirmación durables con cuenta regresiva — la duda genuina se pregunta, no se adivina."
      pill={
        done ? (
          <Badge variant="success" className="text-[10px]">Verificado</Badge>
        ) : (
          <Badge variant="agent" dot className="[&>span]:animate-pulse text-[10px]">
            Procesando
          </Badge>
        )
      }
    >
      <div className="flex h-full flex-col justify-between gap-3">
        {/* Reserved to the tallest step per breakpoint (measured 133px at 320w,
            147px in the md 3-col band, 133px at 1024w, 117px at ≥1280w). The
            card is h-full inside the grid, so any overflow resizes its row. */}
        <div className={cn(STACK, "min-h-[9.5rem] md:min-h-[9.25rem] lg:min-h-[8.5rem] xl:min-h-[7.5rem]")}>
          <AnimatePresence initial={false}>
            {step === 0 ? (
              <m.div
                key="proc"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="flex items-center gap-2 text-[10px]"
              >
                <MockSpinner />
                <MockShimmerText>
                  Verificando que toda la información requerida esté presente...
                </MockShimmerText>
              </m.div>
            ) : step === 1 ? (
              <m.div
                key="ask"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="rounded-md border border-warning/40 bg-warning/10 p-2.5"
              >
                {/* Verbatim BLANKET_ENDORSEMENT_APPLIES question — one of the
                    three confirmation kinds the harness can actually raise. */}
                <p className="text-[11px] font-medium leading-snug text-warning">
                  El certificado no indica la condición de asegurado adicional. ¿Aplica a esta
                  relación un endoso general (blanket) de asegurado adicional en la póliza?
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="rounded-md bg-primary px-3 py-1 text-[10px] font-medium text-primary-foreground">
                    Sí
                  </span>
                  <span className="rounded-md border border-input bg-card px-3 py-1 text-[10px] font-medium">
                    No
                  </span>
                </div>
                {/* Countdown drains for exactly this scene's duration. */}
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-warning/20">
                  <div className="animate-drain h-full rounded-full bg-warning" />
                </div>
                <p className="mt-1.5 text-[9px] text-muted-foreground">
                  Responda en un plazo de 4:59 — de lo contrario, el procesamiento continúa
                  automáticamente.
                </p>
              </m.div>
            ) : step === 2 ? (
              <m.div
                key="answered"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="rounded-md border border-success/25 bg-success/10 px-2.5 py-2 text-[10px] text-success"
              >
                <CheckCircle2Icon className="mr-1 inline h-3 w-3" />
                Respuesta registrada: Sí — el agente continúa con su confirmación.
              </m.div>
            ) : (
              <m.div
                key="done"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="space-y-1 text-[10px]"
              >
                {/* The doc-card renders each rule's runtime message, not the
                    short console label — quoted from validators.ts. */}
                <p className="flex items-start gap-1.5">
                  <CheckCircle2Icon className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                  El nombre en el certificado coincide con el proveedor registrado.
                </p>
                <p className="flex items-start gap-1.5">
                  <CheckCircle2Icon className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                  El certificado está actualmente en vigor (vence el 2027-05-12).
                </p>
                <p className="pt-1 text-muted-foreground">4 aprobadas · 0 fallidas · 1 informativa</p>
              </m.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </CaseCard>
  );
}

// ── Caso 4 · Falla acotada + exención del oficial ───────────────────────────

const WAIVER_DURATIONS = [1300, 2000, 1700, 3100] as const;
// 0: procesando · 1: falla de nombre pero cuenta para cobertura · 2: diálogo de
// exención del oficial · 3: eximido (asentado)

function ScopedWaiverCase() {
  const step = useSceneLoop(WAIVER_DURATIONS);

  return (
    <CaseCard
      file="coi-filial.pdf"
      type="Certificado de seguro (ACORD 25)"
      footer="Falla acotada: un certificado a nombre de la filial no acredita identidad, pero sus límites sí cuentan — y el oficial puede eximir solo lo que la falla bloquea."
      pill={
        <span className={STACK}>
        <AnimatePresence initial={false}>
          <m.span
            key={step}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.09 } }}
          >
            {step === 0 ? (
              <Badge variant="agent" dot className="[&>span]:animate-pulse text-[10px]">
                Procesando
              </Badge>
            ) : step === 3 ? (
              <Badge variant="success" className="text-[10px]">Eximido</Badge>
            ) : (
              <Badge variant="warning" className="text-[10px]">Contado · cobertura</Badge>
            )}
          </m.span>
        </AnimatePresence>
        </span>
      }
    >
      <div className="flex h-full flex-col justify-between gap-3">
        <div className={cn(STACK, "min-h-[7.5rem]")}>
          <AnimatePresence initial={false}>
            {step === 0 ? (
              <m.div
                key="proc"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="flex items-center gap-2 text-[10px]"
              >
                <MockSpinner />
                <MockShimmerText>
                  Vinculando este documento con sus requisitos de cumplimiento...
                </MockShimmerText>
              </m.div>
            ) : step === 1 ? (
              <m.div
                key="scoped"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="space-y-1.5"
              >
                <p className="flex items-start gap-1.5 text-[10px] text-destructive">
                  <XCircleIcon className="mt-0.5 h-3 w-3 shrink-0" />
                  El nombre en el certificado («Acme Construction LLC») no coincide con el
                  proveedor registrado («Acme Constructora SpA»).
                </p>
                <p className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] leading-relaxed text-warning">
                  Aún cuenta para: Seguro de responsabilidad civil general — la revisión de
                  cobertura decide los límites finales.
                </p>
              </m.div>
            ) : step === 2 ? (
              <m.div
                key="waive"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="rounded-md border border-border/60 bg-card p-2.5 shadow-soft"
              >
                <p className="text-[11px] font-semibold">Eximir de la validación</p>
                <p className="mt-1 flex items-center gap-1.5 text-[10px]">
                  <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border border-agent bg-agent/10">
                    <CheckCircle2Icon className="h-2.5 w-2.5 text-agent" />
                  </span>
                  Identidad fiscal
                </p>
                <p className="mt-1 text-[9px] text-muted-foreground">
                  Vencimiento de la exención: 21 nov 2026 · la justificación queda en el registro de
                  auditoría.
                </p>
                <div className="mt-1.5 flex justify-end">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground">
                    <MockSpinner className="border-primary-foreground/60 border-t-transparent" />
                    Aplicando…
                  </span>
                </div>
              </m.div>
            ) : (
              <m.div
                key="waived"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
                className="space-y-1.5"
              >
                <p className="rounded-md border border-success/25 bg-success/10 px-2 py-1.5 text-[10px] text-success">
                  <CheckCircle2Icon className="mr-1 inline h-3 w-3" />
                  Eximido por su oficial de cumplimiento hasta el 21 nov 2026
                </p>
                <p className="text-[10px] text-muted-foreground">
                  El servidor vuelve a acotar el alcance: una discrepancia de nombre nunca puede
                  extender la exención a otra categoría.
                </p>
              </m.div>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-1 rounded-md border border-border/60 bg-card px-2.5 py-2">
          <p className="text-[10px] font-semibold">Actividad</p>
          <p
            className={cn(
              "text-[10px] tabular-nums text-muted-foreground transition-opacity",
              step >= 1 ? "opacity-100" : "opacity-35",
            )}
          >
            23 ago 2026 documento verificado
          </p>
          <p
            className={cn(
              "text-[10px] tabular-nums text-muted-foreground transition-opacity",
              step >= 3 ? "opacity-100" : "opacity-35",
            )}
          >
            23 ago 2026 documento eximido
          </p>
        </div>
      </div>
    </CaseCard>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

export function LiveCases() {
  return (
    <section id="casos" aria-labelledby="cases-title" className="scroll-mt-20 bg-card/40 py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="cases-title"
          eyebrow="Casos en vivo"
          title="Los casos difíciles, manejados a la vista"
          subtitle="Pólizas que se apilan, certificados a nombre de la filial, credenciales que vencen y preguntas que merecen un humano — así se ven en Vendra, mientras suceden."
        />
        {/* Two-up: these cards carry dense readouts, so wider beats more
            columns — four narrow ones would force the money figures to wrap. */}
        <Stagger className="mt-14 grid gap-4 md:grid-cols-2">
          <StaggerItem className="min-w-0">
            <CoverageStackCase />
          </StaggerItem>
          <StaggerItem className="min-w-0">
            <ScopedWaiverCase />
          </StaggerItem>
          <StaggerItem className="min-w-0">
            <ExpiryRenewalCase />
          </StaggerItem>
          <StaggerItem className="min-w-0">
            <HitlCase />
          </StaggerItem>
        </Stagger>
      </div>
    </section>
  );
}
