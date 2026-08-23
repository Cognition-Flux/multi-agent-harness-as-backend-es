"use client";

import { ArrowRightIcon, BotIcon, CpuIcon, FileTextIcon, UserCheckIcon } from "lucide-react";
import { m } from "motion/react";

import { ARCHITECTURE_CARDS } from "../landing-data";
import { Reveal, Stagger, StaggerItem } from "../motion";
import { SectionHeading } from "./section-heading";

const FLOW = [
  { icon: FileTextIcon, label: "Documento" },
  { icon: BotIcon, label: "Agente Claude · MicroVM" },
  { icon: CpuIcon, label: "Motor determinista" },
  { icon: UserCheckIcon, label: "Oficial de cumplimiento" },
] as const;

export function Architecture() {
  return (
    <section
      id="arquitectura"
      aria-labelledby="architecture-title"
      className="scroll-mt-20 border-y border-border/60 bg-card/40 py-20 md:py-28"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="architecture-title"
          eyebrow="Arquitectura"
          title="Confianza por diseño, no por promesa"
          subtitle="La inteligencia corre aislada, las decisiones son reproducibles y sus datos nunca salen de sus propios contenedores."
        />

        {/* The adjudication flow, as a compact animated strip. */}
        <Reveal className="mt-12" delay={0.1}>
          <div className="relative mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-2 overflow-hidden rounded-lg border border-border/60 bg-card px-4 py-3 shadow-soft sm:gap-3">
            {/* A pulse sweeping the adjudication flow, left to right. */}
            <span
              aria-hidden
              className="animate-travel-x absolute bottom-0 h-px w-16 bg-gradient-to-r from-transparent via-agent to-transparent"
            />
            {FLOW.map((node, i) => (
              <m.div
                key={node.label}
                className="flex items-center gap-2 sm:gap-3"
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.15 + i * 0.15, duration: 0.45, ease: "easeOut" }}
              >
                <span className="flex items-center gap-1.5 rounded-md border border-agent/20 bg-agent/5 px-2.5 py-1.5 text-xs font-medium">
                  <node.icon className="h-3.5 w-3.5 text-agent" />
                  {node.label}
                </span>
                {i < FLOW.length - 1 ? (
                  <ArrowRightIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : null}
              </m.div>
            ))}
          </div>
        </Reveal>

        <Stagger className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ARCHITECTURE_CARDS.map((card) => (
            <StaggerItem key={card.title}>
              <div className="h-full rounded-lg border border-border/60 bg-card p-6 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-lift">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-foreground">
                  <card.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-sm font-semibold">{card.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{card.description}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
