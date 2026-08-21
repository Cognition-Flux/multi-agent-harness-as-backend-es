/**
 * Company-roster segment skeleton — shaped like the roster rows so a slow load
 * resolves in place instead of falling back to the app-level spinner.
 */
import { Shimmer } from "@/components/ui/primitives";

const ROWS = [0, 1, 2];

export default function PlatformLoading() {
  return (
    <main role="status" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <span className="sr-only">Cargando empresas…</span>
      <div aria-hidden className="flex animate-fade-in flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Shimmer className="h-3 w-20" />
          <Shimmer className="h-7 w-40" />
          <Shimmer className="h-4 w-full max-w-md" />
        </div>
        <div className="flex flex-col gap-2">
          {ROWS.map((row) => (
            <Shimmer key={row} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </main>
  );
}
