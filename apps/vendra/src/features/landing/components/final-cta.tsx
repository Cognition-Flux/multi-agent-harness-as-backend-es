"use client";

import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { onAnchorClick } from "../anchor";
import { NAV_LINKS } from "../landing-data";
import { Reveal } from "../motion";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden py-20 md:py-28">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(42rem_24rem_at_50%_115%,hsl(var(--agent)/0.12),transparent_65%)]"
      />
      <Reveal className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
        <h2 id="cta-title" className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Empiece con su primer documento{" "}
          <span className="animate-gradient-pan bg-[length:200%_auto] text-gradient-brand">
            hoy mismo
          </span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground sm:text-lg">
          Registre su empresa, arrastre un certificado y vea a su primer agente trabajar en vivo —
          la activación queda a un expediente de distancia.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/25 transition-all duration-200 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] sm:w-auto"
          >
            Registre su empresa
            <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 w-full items-center justify-center rounded-md border border-input bg-card px-6 text-sm font-medium transition-all duration-200 hover:border-ring/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] sm:w-auto"
          >
            Ya tengo cuenta — iniciar sesión
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

export function LandingFooter({ year }: { year: number }) {
  return (
    <footer className="border-t border-border/60 bg-card/40">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <p className="animate-gradient-pan bg-[length:200%_auto] text-gradient-brand text-lg font-bold tracking-tight">
            Vendra
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Incorporación de proveedores adjudicada por IA y cumplimiento continuo — con tecnología
            de un backend de harness de Claude Code.
          </p>
        </div>
        <nav aria-label="Pie de página" className="grid grid-cols-2 gap-8 sm:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Producto
            </p>
            <ul className="mt-3 space-y-2">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={onAnchorClick}
                    className="rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Acceso
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <Link
                  href="/login"
                  className="rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Iniciar sesión
                </Link>
              </li>
              <li>
                <Link
                  href="/register"
                  className="rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Registre su empresa
                </Link>
              </li>
            </ul>
          </div>
        </nav>
      </div>
      <div className="border-t border-border/40">
        <p className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-muted-foreground sm:px-6">
          © {year} Vendra — sus datos viven en sus propios contenedores.
        </p>
      </div>
    </footer>
  );
}
