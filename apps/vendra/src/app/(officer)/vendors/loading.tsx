/**
 * Roster segment loading state — a toolbar + table skeleton shaped like the
 * officer roster, so slow loads resolve in place instead of falling back to
 * the app-level spinner.
 */
import { Shimmer } from "@/components/ui/primitives";

const ROSTER_ROWS = [0, 1, 2, 3, 4];

export default function VendorsLoading() {
  return (
    <main role="status" className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <span className="sr-only">Cargando proveedores…</span>
      <div aria-hidden className="flex animate-fade-in flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Shimmer className="h-7 w-40" />
          <div className="flex items-center gap-2">
            <Shimmer className="h-9 w-40 sm:w-56" />
            <Shimmer className="h-9 w-24" />
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-border/60 bg-card/60">
          <div className="flex items-center gap-4 border-b border-border/60 px-4 py-3">
            <Shimmer className="h-4 w-1/4" />
            <Shimmer className="hidden h-4 w-1/6 sm:block" />
            <Shimmer className="hidden h-4 w-1/6 md:block" />
            <Shimmer className="ml-auto h-4 w-16" />
          </div>
          {ROSTER_ROWS.map((row) => (
            <div key={row} className="flex items-center gap-4 border-b border-border/40 px-4 py-3.5 last:border-b-0">
              <Shimmer className="h-4 w-1/4" />
              <Shimmer className="hidden h-4 w-1/6 sm:block" />
              <Shimmer className="hidden h-4 w-1/6 md:block" />
              <Shimmer className="ml-auto h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
