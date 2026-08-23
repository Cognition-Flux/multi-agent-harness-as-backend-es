"use client";

import { MenuIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, m, useReducedMotion, useScroll, useSpring } from "motion/react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { onAnchorClick } from "../anchor";
import { NAV_LINKS } from "../landing-data";

export function LandingNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { scrollYProgress } = useScroll();
  const spring = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.4 });
  // MotionConfig reducedMotion covers gestures/animations but not useSpring;
  // bind the raw progress for reduced-motion users so the bar tracks the
  // scroll with no residual spring overshoot.
  const reduced = useReducedMotion();
  const progress = reduced ? scrollYProgress : spring;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Anchor navigation closes the mobile menu so the target is visible.
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      {/* Reading progress — brand orange hairline above everything. */}
      <m.div
        aria-hidden
        style={{ scaleX: progress }}
        className="h-0.5 origin-left bg-gradient-to-r from-agent via-[hsl(30_90%_45%)] to-agent"
      />
      <div
        className={cn(
          "transition-[background-color,box-shadow,border-color] duration-300",
          scrolled ? "glass shadow-soft" : "border-b border-transparent bg-transparent",
        )}
      >
        <nav
          aria-label="Principal"
          className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
        >
          <a
            href="#inicio"
            className="rounded-sm text-lg font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={(e) => {
              closeMenu();
              onAnchorClick(e);
            }}
          >
            <span className="animate-gradient-pan bg-[length:200%_auto] text-gradient-brand">
              Vendra
            </span>
          </a>

          <div className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={onAnchorClick}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/register"
              className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/25 transition-all duration-200 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              Registre su empresa
            </Link>
          </div>

          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? "landing-mobile-menu" : undefined}
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </nav>

        <AnimatePresence>
          {menuOpen ? (
            <m.div
              id="landing-mobile-menu"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="glass overflow-hidden border-t border-border/60 lg:hidden"
            >
              {/* Scrolls internally on short landscape-phone viewports where
                  the fixed header would otherwise cut off the bottom CTAs. */}
              <div className="flex max-h-[calc(100dvh-3.625rem)] flex-col gap-1 overflow-y-auto px-4 py-3">
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={(e) => {
                      closeMenu();
                      onAnchorClick(e);
                    }}
                    className="rounded-md px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {link.label}
                  </a>
                ))}
                <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-3">
                  <Link
                    href="/login"
                    onClick={closeMenu}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-card text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Iniciar sesión
                  </Link>
                  <Link
                    href="/register"
                    onClick={closeMenu}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Registre su empresa
                  </Link>
                </div>
              </div>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    </header>
  );
}
