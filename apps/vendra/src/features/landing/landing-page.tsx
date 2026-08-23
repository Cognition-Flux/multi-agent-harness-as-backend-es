"use client";

import { onAnchorClick } from "./anchor";
import { LandingMotionProvider, LandingMotionState } from "./motion";
import { Architecture } from "./components/architecture";
import { FeatureBento } from "./components/feature-bento";
import { FinalCta, LandingFooter } from "./components/final-cta";
import { Hero } from "./components/hero";
import { LandingNav } from "./components/landing-nav";
import { LiveCases } from "./components/live-cases";
import { Pipeline } from "./components/pipeline";
import { Showcase } from "./components/showcase";
import { StatsStrip } from "./components/stats-strip";
import { TypeMarquee } from "./components/type-marquee";

/**
 * Public landing page, rendered at `/` for signed-out visitors (signed-in
 * users are role-redirected before this mounts — see app/page.tsx). Every
 * claim on the page mirrors real behavior of the portal, officer, platform
 * and assistant surfaces.
 *
 * `year` comes from the server render so the copyright line can never
 * disagree between SSR HTML and hydration. LandingMotionState carries the
 * WCAG 2.2.2 pause toggle (hero button) to every self-running scene.
 */
export function LandingPage({ year }: { year: number }) {
  return (
    <LandingMotionProvider>
      <LandingMotionState>
        <a
          href="#inicio"
          onClick={onAnchorClick}
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Saltar al contenido
        </a>
        <LandingNav />
        <main>
          <Hero />
          <StatsStrip />
          <TypeMarquee />
          <Pipeline />
          <LiveCases />
          <Showcase />
          <FeatureBento />
          <Architecture />
          <FinalCta />
        </main>
        <LandingFooter year={year} />
      </LandingMotionState>
    </LandingMotionProvider>
  );
}
