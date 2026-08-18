"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Loader } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [legalName, setLegalName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/vendor/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legalName, contactName, email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "No se pudo completar el registro.");
        setSubmitting(false);
        return;
      }
      // Keep the button disabled through the navigations below — re-enabling
      // early opens a double-submit window.
      const signIn = await authClient.signIn.email({ email, password });
      if (signIn.error) {
        router.push("/login?created=1");
        return;
      }
      router.push("/portal");
      router.refresh();
    } catch {
      setError("Algo salió mal — verifique su conexión e intente de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="flex w-full max-w-md animate-fade-in-up flex-col items-center gap-5">
        <p className="animate-gradient-pan bg-[length:200%_auto] text-lg font-semibold tracking-tight text-gradient-brand">
          Vendra
        </p>
        <Card className="glass w-full shadow-lift">
          <CardHeader>
            <CardTitle className="text-lg">Registre su empresa</CardTitle>
            <p className="text-sm text-muted-foreground">
              Cree una cuenta de proveedor para comenzar su proceso de incorporación y cumplimiento.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="legalName">Razón social de la empresa</Label>
                <Input id="legalName" value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="contactName">Su nombre</Label>
                <Input id="contactName" value={contactName} onChange={(e) => setContactName(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  aria-describedby="password-hint"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p id="password-hint" className="text-xs text-muted-foreground">
                  Al menos 8 caracteres.
                </p>
              </div>
              {error ? (
                <p
                  role="alert"
                  className="animate-fade-in rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader className="h-4 w-4 text-primary-foreground" />
                    Creando cuenta…
                  </>
                ) : (
                  "Crear cuenta"
                )}
              </Button>
            </form>
            <p className="mt-4 text-sm text-muted-foreground">
              ¿Ya está registrado?{" "}
              <Link
                href="/login"
                className="rounded-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Iniciar sesión
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
