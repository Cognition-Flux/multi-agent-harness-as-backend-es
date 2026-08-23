/**
 * Landing-page motion foundation. LazyMotion keeps the initial bundle to the
 * `m.*` runtime and loads the animation feature set (domMax: variants,
 * whileInView, layout — the tab indicator needs layoutId) once, client-side.
 * MotionConfig reducedMotion="user" disables transform animation for
 * prefers-reduced-motion visitors while still fading opacity in.
 */
"use client";

import { LazyMotion, MotionConfig, domMax, m, useReducedMotion } from "motion/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export function LandingMotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

// ── Pause control (WCAG 2.2.2) ───────────────────────────────────────────────
// One visible toggle (in the hero) governs every self-running scene on the
// page: JS loops read `paused` from this context; CSS loops are frozen by the
// [data-motion-paused] rule in globals.css.

const LandingMotionContext = createContext<{ paused: boolean; toggle: () => void }>({
  paused: false,
  toggle: () => {},
});

export function LandingMotionState({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  return (
    <LandingMotionContext.Provider value={{ paused, toggle: () => setPaused((v) => !v) }}>
      <div data-motion-paused={paused || undefined}>{children}</div>
    </LandingMotionContext.Provider>
  );
}

export function useLandingMotion() {
  return useContext(LandingMotionContext);
}

// ── Scene loop ───────────────────────────────────────────────────────────────

/**
 * Self-running scene sequencer for the animated product demos. Starts at 0
 * (never seeded from useReducedMotion — that is null on the server and real
 * on the first client render, i.e. a guaranteed hydration mismatch) and
 * advances per `durations[i]` ms, looping. Reduced-motion visitors are
 * snapped to the LAST scene (the settled, complete state); the pause toggle
 * freezes the current scene.
 *
 * `durations` must be a stable (module-level) array.
 */
export function useSceneLoop(durations: readonly number[]): number {
  const { paused } = useLandingMotion();
  const reduced = useReducedMotion();
  const [scene, setScene] = useState(0);

  useEffect(() => {
    if (reduced) {
      setScene(durations.length - 1);
      return;
    }
    if (paused) return;
    const t = setTimeout(() => setScene((s) => (s + 1) % durations.length), durations[scene]);
    return () => clearTimeout(t);
  }, [scene, paused, reduced, durations]);

  return scene;
}

/**
 * Character-by-character reveal for the assistant demo. Returns the visible
 * slice of `text`. Inactive → empty; reduced motion or `done` → full text.
 *
 * `done` matters because this ticks on its own timer chain: a backgrounded
 * tab clamps setTimeout to ~1s, which would leave the reveal far behind the
 * scene loop. Passing `done` when the scene advances past the streaming step
 * snaps it complete instead of parking on a truncated sentence.
 */
export function useTypewriter(
  text: string,
  active: boolean,
  done = false,
  charsPerTick = 2,
  tickMs = 30,
): string {
  const { paused } = useLandingMotion();
  const reduced = useReducedMotion();
  const [chars, setChars] = useState(0);

  useEffect(() => {
    if (!active) {
      setChars(0);
      return;
    }
    if (reduced || done) {
      setChars(text.length);
      return;
    }
    if (paused || chars >= text.length) return;
    const t = setTimeout(() => setChars((c) => Math.min(text.length, c + charsPerTick)), tickMs);
    return () => clearTimeout(t);
  }, [active, chars, paused, reduced, done, text, charsPerTick, tickMs]);

  return text.slice(0, chars);
}

// ── Reveal helpers ───────────────────────────────────────────────────────────

const EASE_OUT_SOFT = [0.21, 0.47, 0.32, 0.98] as const;

/** Scroll-triggered reveal: fades/slides in the first time it enters view. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 20,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  return (
    <m.div
      // data-reveal: these render at opacity 0 in the SSR HTML and only become
      // visible once motion runs, so globals.css un-hides them under <noscript>.
      data-reveal
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.6, delay, ease: EASE_OUT_SOFT }}
    >
      {children}
    </m.div>
  );
}

export const staggerParent = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

export const staggerChild = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT_SOFT } },
};

/** Parent that staggers its `StaggerItem` children when scrolled into view. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <m.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
    >
      {children}
    </m.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <m.div data-reveal className={className} variants={staggerChild}>
      {children}
    </m.div>
  );
}
