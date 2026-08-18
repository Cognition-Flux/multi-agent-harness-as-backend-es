"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Loader } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("created")) setNotice("Account created — sign in with your new credentials.");
    if (params.has("expired")) setNotice("Your session expired — sign in again.");
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Sign-in failed.");
        setSubmitting(false);
        return;
      }
      // Keep the button disabled through the navigation.
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong — check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <Card className="glass w-full max-w-sm animate-fade-in-up shadow-lift">
        <CardHeader>
          <CardTitle className="animate-gradient-pan bg-[length:200%_auto] text-xl tracking-tight text-gradient-brand">
            Vendra
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Sign in to the vendor portal or the compliance-officer dashboard.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {notice && !error ? (
              <p
                role="status"
                className="animate-fade-in rounded-md border border-info/20 bg-info/10 px-3 py-2 text-sm text-info"
              >
                {notice}
              </p>
            ) : null}
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
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            New vendor?{" "}
            <Link
              href="/register"
              className="rounded-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Register your business
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
