"use client";

import { onAnchorClick } from "./anchor";
import { ASSISTANT_DEEP_DIVE, GOVERNANCE_SETUP, OFFICER_ACTIONS } from "./landing-data";
import { LandingMotionProvider, LandingMotionState } from "./motion";
import { Architecture } from "./components/architecture";
import { AssistantTaskScene } from "./components/assistant-task-scene";
import { DeepDiveSection } from "./components/deep-dive-section";
import { FeatureBento } from "./components/feature-bento";
import { FinalCta, LandingFooter } from "./components/final-cta";
import { GovernanceSetupScene } from "./components/governance-setup-scene";
import { Hero } from "./components/hero";
import { LandingNav } from "./components/landing-nav";
import { LiveCases } from "./components/live-cases";
import { OfficerActionsScene } from "./components/officer-actions-scene";
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
          {/* Three deep dives, one per role, alternating ground and mock side
              after the showcase tabs (which put their mock on the left). */}
          <DeepDiveSection
            id="asistente"
            copy={ASSISTANT_DEEP_DIVE}
            mock={<AssistantTaskScene />}
            mockSide="right"
            tinted
          />
          <DeepDiveSection
            id="adjudicacion"
            copy={OFFICER_ACTIONS}
            mock={<OfficerActionsScene />}
            mockSide="left"
          />
          <DeepDiveSection
            id="gobernanza"
            copy={GOVERNANCE_SETUP}
            mock={<GovernanceSetupScene />}
            mockSide="right"
            tinted
          />
          <FeatureBento />
          <Architecture />
          <FinalCta />
        </main>
        <LandingFooter year={year} />
      </LandingMotionState>
    </LandingMotionProvider>
  );
}
