"use client";

/**
 * The superadmin company roster (SPEC §19.5) — the platform operator's home.
 *
 * Deliberately NOT a copy of the vendor roster: a superadmin is not adjudicating
 * anything, so the row reads as a tenancy summary (how many vendors, which
 * policy version governs them, is a draft pending) rather than a compliance
 * verdict. No status badge, because a company has no compliance status.
 */
import { useQuery } from "@tanstack/react-query";
import { BuildingIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  Shimmer,
} from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/lib/trpc-client";
import { formatDate } from "@/lib/utils";

import { ProvisionCompanyDialog } from "./dialogs";

export function CompaniesRoster() {
  const trpc = useTRPC();
  const [creating, setCreating] = useState(false);
  const companiesQuery = useQuery(trpc.platform.listCompanies.queryOptions());

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Plataforma
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Cada empresa define qué documentos acepta, cómo se validan y qué
            requisitos puede aprobar el sistema por su cuenta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreating(true)}>
            <PlusIcon className="mr-1.5 h-4 w-4" />
            Nueva empresa
          </Button>
          <Button
            variant="ghost"
            onClick={() => void authClient.signOut().then(() => location.assign("/login"))}
          >
            Salir
          </Button>
        </div>
      </header>

      {companiesQuery.isPending ? (
        <div className="flex flex-col gap-2">
          <Shimmer className="h-20 w-full" />
          <Shimmer className="h-20 w-full" />
        </div>
      ) : companiesQuery.isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No se pudieron cargar las empresas.{" "}
            <button
              className="underline"
              onClick={() => void companiesQuery.refetch()}
            >
              Reintentar
            </button>
          </CardContent>
        </Card>
      ) : (companiesQuery.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BuildingIcon className="h-8 w-8 text-muted-foreground/60" />
            <div>
              <p className="text-sm font-medium">Todavía no hay empresas</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Cree la primera para empezar a recibir proveedores.
              </p>
            </div>
            <Button onClick={() => setCreating(true)}>Nueva empresa</Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {(companiesQuery.data ?? []).map((company) => (
            <li key={company.uuid}>
              <Link
                href={`/platform/${company.uuid}`}
                className="group block rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:border-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{company.name}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {company.slug}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {company.officerCount === 0 ? (
                      <Badge variant="warning">Sin oficiales</Badge>
                    ) : null}
                    {company.hasDraft ? (
                      <Badge variant="warning">Borrador sin activar</Badge>
                    ) : null}
                    {company.policy ? (
                      <Badge variant="secondary">v{company.policy.version}</Badge>
                    ) : (
                      <Badge variant="destructive">Sin política</Badge>
                    )}
                    <ChevronRightIcon className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Proveedores</dt>
                    <dd className="font-medium tabular-nums">{company.vendorCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Documentos aceptados</dt>
                    <dd className="font-medium tabular-nums">
                      {company.policy?.acceptedDocumentTypes ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Aprobación automática</dt>
                    <dd className="font-medium tabular-nums">
                      {company.policy
                        ? `${company.policy.refereeableCategories} categorías`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Creada</dt>
                    <dd className="font-medium">{formatDate(company.createdAt)}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating ? <ProvisionCompanyDialog onClose={() => setCreating(false)} /> : null}
    </main>
  );
}
