"use client";

import { cn } from "@/lib/utils";

import { BENTO_TILES } from "../landing-data";
import { Stagger, StaggerItem } from "../motion";
import { SectionHeading } from "./section-heading";

export function FeatureBento() {
  return (
    <section
      id="funcionalidades"
      aria-labelledby="bento-title"
      className="scroll-mt-20 py-20 md:py-28"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id="bento-title"
          eyebrow="Funcionalidades"
          title="Capas que se gobiernan entre sí"
          subtitle="Agentes que trabajan, reglas que deciden, personas que aprueban — y todo queda registrado."
        />

        <Stagger className="mt-14 grid gap-4 md:grid-cols-3">
          {BENTO_TILES.map((tile) => (
            <StaggerItem key={tile.title} className={cn("min-w-0", tile.span)}>
              <div className="group relative h-full overflow-hidden rounded-lg border border-border/60 bg-card p-6 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-agent/30 hover:shadow-glow">
                {/* Corner wash that warms up on hover. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-agent/5 blur-2xl transition-opacity duration-500 group-hover:bg-agent/10"
                />
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-agent/20 bg-agent/10 text-agent transition-transform duration-300 group-hover:scale-105">
                  <tile.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{tile.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{tile.description}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
