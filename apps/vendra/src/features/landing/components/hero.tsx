"use client";

import {
  ArrowRightIcon,
  CheckCircle2Icon,
  FileTextIcon,
  PauseIcon,
  PlayIcon,
  ShieldCheckIcon,
  TimerIcon,
} from "lucide-react";
import Link from "next/link";
import {
  AnimatePresence,
  m,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { Fragment, type PointerEvent } from "react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

import { useLandingMotion, useSceneLoop } from "../motion";
import { STACK } from "./mock-frame";

/**
 * The hero's centerpiece: a faithful miniature of the portal's live doc-card
 * cycling through real pipeline stages (labels from STAGE_MESSAGES) and
 * settling on the verified state before looping. Purely decorative — the
 * real thing lives in the portal.
 */
const SCENES = [
  {
    stage: 2,
    message: "Analizando el contenido y la estructura del documento...",
    narration: "Encabezado ACORD 25 visible; asegurado y vigencias legibles.",
  },
  {
    stage: 4,
    message: "Leyendo y extrayendo la información clave...",
    narration: "Límite por ocurrencia $1.000.000 · umbrella $1.000.000.",
  },
  {
    stage: 6,
    message: "Verificando que toda la información requerida esté presente...",
    narration: "4 aprobadas · 0 fallidas · 1 informativa.",
  },
  {
    // mapping is STAGE_INDEX 7 — stage 8 is finalizing, with its own message.
    stage: 7,
    message: "Vinculando este documento con sus requisitos de cumplimiento...",
    narration: "Acredita: Seguro de responsabilidad civil general.",
  },
] as const;

// Brisk on purpose: four stage beats in ~5.6s, then the verified state holds
// long enough to read. The whole page's claim is throughput — a languid demo
// argues the opposite.
const DURATIONS = [1400, 1400, 1400, 1400, 3000] as const;
const VERIFIED_STEP = DURATIONS.length - 1;

/** Fields acord25Schema actually extracts, formatted like formatUsd/formatDate. */
const EXTRACTED_ROWS = [
  ["Asegurado", "Acme Constructora SpA"],
  ["Límite por ocurrencia", "$1.000.000"],
  ["Asegurado adicional", "Sí"],
  ["Vence el", "12 may 2027"],
] as const;

function HeroDocCard() {
  const scene = useSceneLoop(DURATIONS);
  const verified = scene === VERIFIED_STEP;
  const current = SCENES[Math.min(scene, SCENES.length - 1)];

  return (
    <div
      aria-hidden
      className={cn(
        "glass relative w-full select-none rounded-lg p-4 text-left transition-shadow duration-500",
        // Scoped duration: the shared animate-glow-pulse (2.4s) also drives
        // real "agent working" surfaces in the product — don't retune it there.
        verified ? "shadow-lift" : "animate-glow-pulse [animation-duration:1.7s]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-agent/10 text-agent">
            <FileTextIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">certificado-seguro.pdf</p>
            <p className="text-xs text-muted-foreground">Certificado de seguro (ACORD 25)</p>
          </div>
        </div>
        <span className={STACK}>
        <AnimatePresence initial={false}>
          {verified ? (
            <m.div
              key="ok"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.09 } }}
            >
              <Badge variant="success">Verificado</Badge>
            </m.div>
          ) : (
            <m.div
              key="run"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.09 } }}
            >
              <Badge variant="agent" dot className="[&>span]:animate-pulse">
                Procesando
              </Badge>
            </m.div>
          )}
        </AnimatePresence>
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{verified ? "Revisión completada" : `Etapa ${current.stage} de 8`}</span>
          <span>{verified ? "8 / 8" : `${current.stage} / 8`}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <m.div
            className={cn(
              "h-full rounded-full",
              verified ? "bg-success" : "bg-gradient-to-r from-agent to-[hsl(30_90%_45%)]",
            )}
            // initial={false} makes the SSR/first paint the animate target —
            // without it motion emits no width and the bar paints 100% full
            // under "Etapa 2 de 8" until hydration animates it down.
            initial={false}
            animate={{ width: `${((verified ? 8 : current.stage) / 8) * 100}%` }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Reserved to the tallest state per breakpoint (measured: 76px below
          640w, 60px at ≥640w — two SCENES messages wrap to two lines) so the
          cycling card never resizes and re-centers the hero column. */}
      <div className={cn(STACK, "mt-3 min-h-[4.75rem] sm:min-h-[3.75rem]")}>
        <AnimatePresence initial={false}>
          {verified ? (
            <m.div
              key="fields"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.1 } }}
              transition={{ duration: 0.22 }}
              className="grid grid-cols-2 gap-x-4 gap-y-1"
            >
              {EXTRACTED_ROWS.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="truncate font-medium">{v}</span>
                </div>
              ))}
            </m.div>
          ) : (
            <m.div
              key={current.message}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.1 } }}
              transition={{ duration: 0.22 }}
            >
              <p className="text-sm font-medium text-agent">{current.message}</p>
              <p className="mt-1 text-xs italic text-muted-foreground">{current.narration}</p>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {/* Slot reserved even while empty — see the height note above. */}
      <div className={cn(STACK, "mt-3 min-h-[3rem] sm:min-h-8")}>
        <AnimatePresence>
          {verified ? (
            <m.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, delay: 0.08 }}
              className="flex items-center gap-1.5 rounded-md border border-success/20 bg-success/10 px-2.5 py-1.5 text-xs font-medium text-success"
            >
              <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0" />
              Acredita: Seguro de responsabilidad civil general
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Headline words; the brand-gradient span covers "revisado en vivo". */
const H1_TEXT = "Cumplimiento de proveedores, revisado en vivo por agentes de IA";
const H1_WORDS: Array<{ word: string; gradient?: boolean }> = [
  { word: "Cumplimiento" },
  { word: "de" },
  { word: "proveedores," },
  { word: "revisado", gradient: true },
  { word: "en", gradient: true },
  { word: "vivo", gradient: true },
  { word: "por" },
  { word: "agentes" },
  { word: "de" },
  { word: "IA" },
];

export function Hero() {
  const { paused, toggle } = useLandingMotion();
  const reduced = useReducedMotion();

  // Pointer-follow tilt on the card stack (fine pointers only; springs give
  // it weight). Values live at 0.5/0.5 (level) until a mouse moves over it.
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [4.5, -4.5]), { stiffness: 150, damping: 18 });
  const rotateY = useSpring(useTransform(px, [0, 1], [-4.5, 4.5]), { stiffness: 150, damping: 18 });

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (reduced || paused || e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  }
  function onPointerLeave() {
    px.set(0.5);
    py.set(0.5);
  }

  return (
    <section id="inicio" aria-labelledby="hero-title" className="relative scroll-mt-20 overflow-hidden">
      <div aria-hidden className="bg-dots absolute inset-0 -z-10 [mask-image:radial-gradient(70%_60%_at_50%_35%,black,transparent)]" />
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-20 pt-28 sm:px-6 md:pb-28 md:pt-36 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="text-center lg:text-left">
          <m.div
            data-reveal
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="inline-flex"
          >
            <Badge variant="agent" dot className="[&>span]:animate-pulse px-3 py-1">
              Adjudicación por IA · gobernada por personas
            </Badge>
          </m.div>

          <m.h1
            data-reveal
            id="hero-title"
            aria-label={H1_TEXT}
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.032, delayChildren: 0.06 } } }}
            className="mt-5 text-balance text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl"
          >
            {/* Real space text nodes, not a trailing margin: a margin on an
                inline-block is part of the line box and is not collapsed at a
                line end, which off-centers every wrapped line. */}
            {H1_WORDS.map((t, i) => (
              <Fragment key={`${t.word}-${i}`}>
                {i > 0 ? " " : null}
                <m.span
                  aria-hidden
                  variants={{
                    hidden: { opacity: 0, y: 16 },
                    visible: { opacity: 1, y: 0, transition: { duration: 0.34, ease: "easeOut" } },
                  }}
                  className={cn(
                    "inline-block",
                    t.gradient && "animate-gradient-pan bg-[length:200%_auto] text-gradient-brand",
                  )}
                >
                  {t.word}
                </m.span>
              </Fragment>
            ))}
          </m.h1>

          <m.p
            data-reveal
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.2, ease: "easeOut" }}
            className="mx-auto mt-5 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg lg:mx-0"
          >
            Cada documento recibe su propio agente de Claude, transmitido en vivo a su navegador.
            La validación, la cobertura y la activación las decide código determinista — y su
            oficial de cumplimiento conserva la última palabra.
          </m.p>

          <m.div
            data-reveal
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.27, ease: "easeOut" }}
            className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start"
          >
            <Link
              href="/login"
              className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/25 transition-all duration-200 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] sm:w-auto"
            >
              Iniciar sesión
              <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/register"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-input bg-card px-6 text-sm font-medium transition-all duration-200 hover:border-ring/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] sm:w-auto"
            >
              Registre su empresa
            </Link>
          </m.div>

          <m.p
            data-reveal
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.35 }}
            className="mt-4 text-xs text-muted-foreground"
          >
            Sin tarjetas ni configuración: registre su empresa y suba su primer documento hoy.
          </m.p>
        </div>

        <m.div
          data-reveal
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.14, ease: "easeOut" }}
          className="mx-auto flex w-full max-w-md flex-col items-center lg:items-end"
        >
          <m.div
            className="relative w-full"
            style={{ rotateX, rotateY, transformPerspective: 900 }}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
          >
            {/* Deck: two ghost cards behind suggest the rest of the queue. */}
            <div
              aria-hidden
              className="absolute inset-x-4 -top-3 h-full rounded-lg border border-border/50 bg-card/50 shadow-soft"
            />
            <div
              aria-hidden
              className="absolute inset-x-2 -top-1.5 h-full rounded-lg border border-border/60 bg-card/70 shadow-soft"
            />

            <HeroDocCard />

            {/* Floating context chips — desktop only, decorative. */}
            <div
              aria-hidden
              className="animate-float absolute -left-6 -top-8 hidden select-none rounded-lg border border-warning/25 bg-card px-3 py-2 shadow-soft lg:block"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-warning">
                <TimerIcon className="h-3.5 w-3.5" />
                ¿La póliza umbrella cubre a la filial?
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Responda en un plazo de 4:59 — Sí / No
              </p>
            </div>
            <div
              aria-hidden
              style={{ animationDelay: "1.1s" }}
              className="animate-float absolute -bottom-7 -right-2 hidden select-none rounded-lg border border-success/25 bg-card px-3 py-2 shadow-soft lg:block xl:-right-8"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-success">
                <ShieldCheckIcon className="h-3.5 w-3.5" />
                Cobertura efectiva: $2.000.000
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Primaria + umbrella · cumple el requisito
              </p>
            </div>
          </m.div>

          {/* WCAG 2.2.2: visible control that freezes every self-running scene
              on the page. Lives outside the aria-hidden card. */}
          <button
            type="button"
            onClick={toggle}
            // No aria-pressed: the accessible name already swaps with state,
            // and pairing both makes SRs announce "Reanudar…, presionado".
            className="mt-4 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:self-start"
          >
            {paused ? (
              <PlayIcon className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <PauseIcon className="h-3.5 w-3.5" aria-hidden />
            )}
            {paused ? "Reanudar animaciones" : "Pausar animaciones"}
          </button>
        </m.div>
      </div>
    </section>
  );
}
