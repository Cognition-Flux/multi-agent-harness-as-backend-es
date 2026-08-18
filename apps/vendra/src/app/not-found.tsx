import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="flex w-full max-w-sm animate-fade-in-up flex-col items-center">
        <p
          aria-hidden
          className="pointer-events-none select-none text-8xl font-semibold tabular-nums tracking-tighter text-primary/10"
        >
          404
        </p>
        <Card className="glass -mt-6 w-full shadow-lift">
          <CardHeader>
            <CardTitle className="text-lg">Página no encontrada</CardTitle>
            <p className="text-sm text-muted-foreground">
              La página que busca no existe o puede haber sido movida.
            </p>
          </CardHeader>
          <CardContent>
            <Link
              href="/"
              className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/25 transition-all duration-200 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
            >
              Volver a la aplicación
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
