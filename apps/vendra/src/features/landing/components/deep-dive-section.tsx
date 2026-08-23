"use client";

/**
 * Shared shell for the three deep-dive sections (assistant / officer /
 * governance). Same contract as the showcase panel: the animated mock is
 * `aria-hidden` decoration and the bullet list beside it is the accessible
 * equivalent, so a screen-reader user loses nothing by not seeing the demo.
 *
 * `mockSide` alternates down the page — showcase puts its mock on the left,
 * so the first deep dive puts it on the right.
 */

import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { DeepDive } from "../landing-data";
import { Reveal } from "../motion";
import { SectionHeading } from "./section-heading";

export function DeepDiveSection({
  id,
  copy,
  mock,
  mockSide,
  tinted = false,
}: {
  /** Section anchor. A literal at the call site, so `check-landing.py` can
   *  match it against NAV_LINKS. */
  id: string;
  copy: DeepDive;
  mock: ReactNode;
  mockSide: "left" | "right";
  /** `bg-card/40` ground — alternate it against the neighbouring sections. */
  tinted?: boolean;
}) {
  const mockLeft = mockSide === "left";
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("scroll-mt-20 py-20 md:py-28", tinted && "border-y border-border/60 bg-card/40")}
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          id={`${id}-title`}
          eyebrow={copy.eyebrow}
          title={copy.title}
          subtitle={copy.subtitle}
        />

        <Reveal
          className={cn(
            "mt-12 grid items-center gap-8 lg:gap-12",
            mockLeft ? "lg:grid-cols-[1.15fr_0.85fr]" : "lg:grid-cols-[0.85fr_1.15fr]",
          )}
          delay={0.06}
        >
          {/* Mock renders after the prose in source order on small screens
              (order-last) so the reading order stays prose-first; at lg it
              takes the side `mockSide` names. */}
          <div
            aria-hidden
            className={cn("order-last min-w-0", mockLeft ? "lg:order-first" : "lg:order-last")}
          >
            {mock}
          </div>
          <ul className={cn("space-y-3", mockLeft ? "lg:order-last" : "lg:order-first")}>
            {copy.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-agent/10">
                  <CheckIcon className="h-3 w-3 text-agent" />
                </span>
                <span className="text-pretty">{b}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
