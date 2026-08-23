"use client";

import { m } from "motion/react";

import { PIPELINE_STEPS } from "../landing-data";
import { Stagger, StaggerItem } from "../motion";
import { SectionHeading } from "./section-heading";

export function Pipeline() {
  return (
    <section
      id="como-funciona"
      aria-labelledby="pipeline-title"
      className="scroll-mt-20 py-20 md:py-28"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="pipeline-title"
          eyebrow="Cómo funciona"
          title="Del documento a la activación, sin cajas negras"
          subtitle="Un flujo de cuatro pasos donde la IA trabaja a la vista y las decisiones son de código determinista y de personas."
        />

        <Stagger className="relative mt-14 grid gap-8 md:grid-cols-4 md:gap-6">
          {/* Connecting rail behind the step markers (desktop), with a pulse
              traveling the flow direction on loop (CSS — obeys the global
              reduced-motion and pause rules). */}
          {/* Aligned to the icon tiles, not the columns: the marker centre sits
              49px in from each card's left edge (1px border + p-6 + half of
              h-12), and a column is 25% - 18px wide, so the right inset is
              colW - 49px. Cards are md:items-start, so a %-only inset misses. */}
          <div
            aria-hidden
            className="absolute left-[49px] right-[calc(25%-67px)] top-[49px] hidden md:block"
          >
            <m.div
              className="h-px origin-left bg-gradient-to-r from-agent/40 via-border to-agent/40"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: "0px 0px -15% 0px" }}
              transition={{ duration: 1.1, ease: "easeOut", delay: 0.2 }}
            />
            <span className="animate-travel-x absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-agent shadow-glow" />
          </div>
          {PIPELINE_STEPS.map((step, i) => (
            <StaggerItem key={step.title} className="relative">
              <div className="group flex h-full flex-col items-center rounded-lg border border-border/60 bg-card/60 p-6 text-center shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-agent/30 hover:shadow-glow md:items-start md:text-left">
                <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-lg border border-agent/20 bg-agent/10 text-agent transition-transform duration-300 group-hover:scale-105">
                  <step.icon className="h-5 w-5" />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Paso {i + 1}
                </p>
                <h3 className="mt-1 text-base font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
