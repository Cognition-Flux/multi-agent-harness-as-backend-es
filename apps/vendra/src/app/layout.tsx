import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Vendra",
  description:
    "Incorporación de proveedores adjudicada por IA y cumplimiento continuo — con tecnología de un backend de harness de Claude Code.",
};

export const viewport: Viewport = {
  // Matches --background (hsl 30 25% 99%) so browser chrome blends in.
  themeColor: "#fdfcfc",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" data-scroll-behavior="smooth">
      <head>
        {/* Scroll-reveal wrappers are server-rendered hidden and only revealed
            by motion; without JS the landing below the hero would stay blank. */}
        <noscript
          dangerouslySetInnerHTML={{
            __html:
              "<style>[data-reveal],[data-reveal] *{opacity:1!important;transform:none!important}</style>",
          }}
        />
      </head>
      <body>
        {/* Shared ambient ground: soft aurora washes behind every page so
            routes stop painting their own competing flat grounds. */}
        <div aria-hidden className="bg-aurora pointer-events-none fixed inset-0 -z-10" />
        {children}
      </body>
    </html>
  );
}
