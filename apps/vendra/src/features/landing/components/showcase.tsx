"use client";

import { CheckIcon } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

import { SHOWCASE_PANELS } from "../landing-data";
import { Reveal } from "../motion";
import { SectionHeading } from "./section-heading";
import { AssistantScene } from "./assistant-scene";
import { OfficerScene } from "./officer-scene";
import { PolicyScene } from "./policy-scene";
import { PortalScene } from "./portal-scene";

const MOCKS: Record<string, () => React.JSX.Element> = {
  portal: PortalScene,
  oficial: OfficerScene,
  gobernanza: PolicyScene,
  asistente: AssistantScene,
};

export function Showcase() {
  const [active, setActive] = useState(SHOWCASE_PANELS[0].id);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const panel = SHOWCASE_PANELS.find((p) => p.id === active) ?? SHOWCASE_PANELS[0];
  const Mock = MOCKS[panel.id] ?? PortalScene;

  // Roving-tabindex arrow navigation, matching the app's ARIA tabs idiom.
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = SHOWCASE_PANELS.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    setActive(SHOWCASE_PANELS[next].id);
    tabsRef.current[next]?.focus();
  }

  return (
    <section id="paneles" aria-labelledby="showcase-title" className="scroll-mt-20 py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="showcase-title"
          eyebrow="Paneles"
          title="Una plataforma, cuatro superficies"
          subtitle="Proveedores, oficiales de cumplimiento y administradores de plataforma trabajan sobre el mismo expediente — cada uno con su propio panel."
        />

        <Reveal className="mt-10" delay={0.1}>
          <div
            role="tablist"
            aria-label="Paneles de la plataforma"
            // Wraps below md — a hidden-scrollbar single row left two of the
            // four surfaces off-screen with no affordance on phones.
            className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-border/60 bg-card p-1 shadow-soft md:w-fit md:flex-nowrap md:rounded-full"
          >
            {SHOWCASE_PANELS.map((p, i) => {
              const selected = p.id === active;
              return (
                <button
                  key={p.id}
                  ref={(el) => {
                    tabsRef.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${p.id}`}
                  aria-selected={selected}
                  aria-controls={`panel-${p.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(p.id)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  className={cn(
                    "relative whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {selected ? (
                    <m.span
                      layoutId="showcase-tab-pill"
                      className="absolute inset-0 rounded-full bg-primary shadow-sm"
                      transition={{ type: "spring", stiffness: 620, damping: 38 }}
                    />
                  ) : null}
                  <span className="relative z-10">{p.tab}</span>
                </button>
              );
            })}
          </div>
        </Reveal>

        {/* APG tabs: a panel with no focusable content is itself focusable so
            Tab moves from the tablist into the panel instead of past it. */}
        <div
          role="tabpanel"
          id={`panel-${panel.id}`}
          aria-labelledby={`tab-${panel.id}`}
          tabIndex={0}
          className="mt-10 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={panel.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="grid items-center gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12"
            >
              <div aria-hidden className="order-last min-w-0 lg:order-first">
                <Mock />
              </div>
              <div>
                <h3 className="text-2xl font-bold tracking-tight">{panel.title}</h3>
                <p className="mt-2 text-muted-foreground">{panel.description}</p>
                <ul className="mt-5 space-y-3">
                  {panel.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-agent/10">
                        <CheckIcon className="h-3 w-3 text-agent" />
                      </span>
                      <span className="text-pretty">{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </m.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
