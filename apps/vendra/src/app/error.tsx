"use client";

/**
 * App-level error boundary — an SSR or render throw lands here instead of
 * Next's unstyled default screen. `reset()` re-renders the failed segment.
 */
import { TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";

import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[vendra:app_error]", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <Card className="glass w-full max-w-sm animate-fade-in-up shadow-lift">
        <CardHeader>
          <div
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"
          >
            <TriangleAlertIcon className="h-5 w-5" />
          </div>
          <CardTitle className="mt-1 text-lg">Something went wrong</CardTitle>
          <p className="text-sm text-muted-foreground">
            The page hit an unexpected error. Your data is safe — try again, and contact your
            compliance team if it keeps happening.
          </p>
          {error.digest ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Reference code:{" "}
              <code className="select-all rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
                {error.digest}
              </code>
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button onClick={() => reset()}>Try again</Button>
          <Button variant="ghost" onClick={() => (window.location.href = "/")}>
            Go home
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
