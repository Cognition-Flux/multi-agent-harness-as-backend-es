"use client";

import { FileTextIcon } from "lucide-react";

import { DOCUMENT_TYPE_TITLES } from "../landing-data";

/**
 * Slow marquee of the 16 accepted document types. The visible track is
 * decorative (aria-hidden — it holds two copies for the seamless loop); a
 * sr-only list carries the same information for assistive tech. The CSS
 * animation is governed by prefers-reduced-motion and the pause toggle.
 */
export function TypeMarquee() {
  const chips = (copy: number) =>
    DOCUMENT_TYPE_TITLES.map((title) => (
      <span
        key={`${copy}-${title}`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs text-muted-foreground"
      >
        <FileTextIcon className="h-3 w-3 text-agent/70" />
        {title}
      </span>
    ));

  return (
    <section aria-label="Tipos de documento aceptados" className="border-b border-border/60 bg-card/40 py-4">
      <p className="sr-only">
        Tipos de documento aceptados: {DOCUMENT_TYPE_TITLES.join(", ")}.
      </p>
      {/* Under reduced motion the transform never runs, so the track would
          park at translateX(0) and hide most chips — fall back to a wrapped,
          unmasked layout that shows all 16. */}
      <div
        aria-hidden
        className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] motion-reduce:[mask-image:none]"
      >
        <div className="animate-marquee flex w-max gap-3 pr-3 will-change-transform motion-reduce:w-auto motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:gap-y-2 motion-reduce:px-4">
          {chips(0)}
          <span className="contents motion-reduce:hidden">{chips(1)}</span>
        </div>
      </div>
    </section>
  );
}
