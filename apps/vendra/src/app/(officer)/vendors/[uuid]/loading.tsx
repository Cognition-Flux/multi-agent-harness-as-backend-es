/**
 * Vendor-detail segment loading state — identity header, tab row, and two
 * panel ghosts shaped like the adjudication surface, so slow loads resolve in
 * place instead of falling back to the app-level spinner.
 */
import { Shimmer } from "@/components/ui/primitives";

export default function VendorDetailLoading() {
  return (
    <main role="status" className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <span className="sr-only">Loading vendor…</span>
      <div aria-hidden className="flex animate-fade-in flex-col gap-4">
        <div className="flex items-center gap-3">
          <Shimmer className="h-12 w-12 rounded-full" />
          <div className="flex flex-col gap-2">
            <Shimmer className="h-5 w-44 sm:w-56" />
            <Shimmer className="h-4 w-32" />
          </div>
          <Shimmer className="ml-auto h-6 w-20 rounded-full" />
        </div>
        <div className="flex items-center gap-2 border-b border-border/60 pb-2">
          <Shimmer className="h-8 w-24" />
          <Shimmer className="h-8 w-24" />
          <Shimmer className="hidden h-8 w-24 sm:block" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 p-4">
            <Shimmer className="h-5 w-1/3" />
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-4 w-2/3" />
            <Shimmer className="h-4 w-1/2" />
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 p-4">
            <Shimmer className="h-5 w-1/3" />
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-4 w-2/3" />
            <Shimmer className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    </main>
  );
}
