/**
 * Portal segment loading state — header bar, summary strip, and two
 * document-card ghosts shaped like the vendor portal, so the janitor + query
 * latency reads as progressive resolution instead of a blank spinner.
 */
import { Shimmer } from "@/components/ui/primitives";

export default function PortalLoading() {
  return (
    <main role="status" className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <span className="sr-only">Cargando su portal…</span>
      <div aria-hidden className="flex animate-fade-in flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Shimmer className="h-6 w-44 sm:w-56" />
            <Shimmer className="h-4 w-32" />
          </div>
          <Shimmer className="h-9 w-28" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Shimmer className="h-20 w-full rounded-lg" />
          <Shimmer className="h-20 w-full rounded-lg" />
          <Shimmer className="h-20 w-full rounded-lg" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <Shimmer className="h-5 w-1/2" />
              <Shimmer className="h-5 w-16 rounded-full" />
            </div>
            <Shimmer className="h-4 w-2/3" />
            <Shimmer className="h-4 w-1/2" />
            <Shimmer className="h-9 w-full" />
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <Shimmer className="h-5 w-1/2" />
              <Shimmer className="h-5 w-16 rounded-full" />
            </div>
            <Shimmer className="h-4 w-2/3" />
            <Shimmer className="h-4 w-1/2" />
            <Shimmer className="h-9 w-full" />
          </div>
        </div>
      </div>
    </main>
  );
}
