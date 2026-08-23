"use client";

import { m, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { STATS } from "../landing-data";
import { Stagger, StaggerItem } from "../motion";

/** Counts 0 → value with an ease-out ramp the first time it scrolls into view. */
function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  // Always start at 0: useReducedMotion() is null on the server but real on
  // the first client render, so seeding from it would be a hydration
  // mismatch for reduced-motion visitors; the effect sets the final value.
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || started.current) return;
        started.current = true;
        const duration = 1100;
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          setDisplay(Math.round(eased * value));
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        observer.disconnect();
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, reduced]);

  return (
    <span ref={ref} className="tabular-nums">
      {display}
    </span>
  );
}

export function StatsStrip() {
  return (
    <section aria-label="Cifras de la plataforma" className="border-y border-border/60 bg-card/40">
      <Stagger className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-4 gap-y-8 px-4 py-10 sm:px-6 md:grid-cols-4 md:py-12">
        {STATS.map((stat) => (
          <StaggerItem key={stat.label} className="text-center">
            <m.p className="animate-gradient-pan bg-[length:200%_auto] text-gradient-brand text-4xl font-bold tracking-tight md:text-5xl">
              <CountUp value={stat.value} />
            </m.p>
            <p className="mt-1.5 text-sm font-medium">{stat.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{stat.detail}</p>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
