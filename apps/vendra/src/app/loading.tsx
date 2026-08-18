/**
 * App-level loading state — the portal SSR runs the janitor plus two queries,
 * so slow loads get a branded skeleton instead of a blank document. The
 * skeleton roughly mirrors the portal/roster shells so content resolves in
 * place instead of jump-cutting.
 */
import { Shimmer } from "@/components/ui/primitives";

export default function AppLoading() {
  return (
    <main role="status" className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <span className="sr-only">Cargando…</span>
      <div aria-hidden className="flex animate-fade-in flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="animate-gradient-pan bg-[length:200%_auto] text-lg font-semibold tracking-tight text-gradient-brand">
            Vendra
          </p>
          <Shimmer className="h-8 w-24" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Shimmer className="h-20 w-full rounded-lg" />
          <Shimmer className="h-20 w-full rounded-lg" />
          <Shimmer className="h-20 w-full rounded-lg" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 p-4">
            <Shimmer className="h-5 w-1/3" />
            <Shimmer className="h-4 w-2/3" />
            <Shimmer className="h-4 w-1/2" />
            <Shimmer className="h-9 w-full" />
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 p-4">
            <Shimmer className="h-5 w-1/3" />
            <Shimmer className="h-4 w-2/3" />
            <Shimmer className="h-4 w-1/2" />
            <Shimmer className="h-9 w-full" />
          </div>
        </div>
      </div>
    </main>
  );
}
