"use client";

/**
 * The officer vendor detail (SPEC §8.2–§8.5): Overview / Documents /
 * Requirement Traceability tabs, the six-mutation rescue toolkit, and the
 * every-surface coverage-determination kick (one POST per false→true
 * determining transition, deduped per vendor per mount) — without it a
 * signature bust leaves the officer staring at "determining" forever.
 *
 * Status-pill machine: `deriveVendorDocumentStatus` is computed ONCE here
 * and passed down — children never re-derive (the drift-regression rule).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { EyeIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { TextShimmer } from "@/components/ai-elements/shimmer";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Loader, Shimmer } from "@/components/ui/primitives";
import { useTRPC } from "@/lib/trpc-client";
import { cn, formatDate, formatUsd } from "@/lib/utils";

import { requirementCategoryLabel, vendorDocumentTypeTitle } from "@vendra/workflow/vendor";

import type { ExistingVendorDocProjection } from "../../lib/vendor-harness-contract";
import { VendorStatusBadge, vendorStatusLabel } from "../vendor-status-badge";
import {
  ErrorLine,
  GrantDialog,
  ReclassifyDialog,
  RevokeDialog,
  WaiveDialog,
  useInvalidateVendorData,
} from "./mutation-dialogs";

// ── The status-pill machine (§8.2 priority order) ────────────────────────────

// Pill derivation + badge live in ./doc-status (shared with the viewer);
// re-exported so existing importers of this module keep working.
export { deriveVendorDocumentStatus, type VendorDocumentPill } from "./doc-status";
import { DocPill, deriveVendorDocumentStatus } from "./doc-status";
import type { VendorDocumentPill } from "./doc-status";
import { DocumentViewerDialog } from "./document-viewer";

/** Coverage-verdict chip mapping (MEETS / BELOW / UNDETERMINED) — literal record. */
const VERDICT_BADGES: Record<string, { label: string; variant: "success" | "destructive" | "muted" }> = {
  MEETS: { label: "Cumple", variant: "success" },
  BELOW: { label: "Por debajo", variant: "destructive" },
  UNDETERMINED: { label: "Sin determinar", variant: "muted" },
};

/** Spanish labels for coverage-line categories (fallback: humanized token). */
const LINE_LABELS: Record<string, string> = {
  GENERAL_LIABILITY: "Responsabilidad civil general",
  WORKERS_COMP: "Compensación laboral",
  AUTO: "Auto comercial",
  CYBER: "Responsabilidad cibernética",
};

/** Spanish labels for the vendor_activity_type enum (fallback: humanized token). */
const ACTIVITY_LABELS: Record<string, string> = {
  DOCUMENT_UPLOADED: "documento subido",
  DOCUMENT_VERIFIED: "documento verificado",
  DOCUMENT_REJECTED: "documento rechazado",
  DOCUMENT_WAIVED: "documento eximido",
  DOCUMENT_RECLASSIFIED: "documento recategorizado",
  DOCUMENT_DELETED: "documento eliminado",
  MANUAL_REQUIREMENT_GRANTED: "requisito otorgado manualmente",
  MANUAL_REQUIREMENT_REVOKED: "concesión manual revocada",
  RETRY_REQUESTED: "reintento solicitado",
  STATUS_CHANGED: "estado actualizado",
  WAIVER_EXPIRED: "exención vencida",
  SWEEP_EXPIRED: "vencimiento detectado por el sistema",
  API_CHECK_RUN: "verificación por API ejecutada",
  VENDOR_REGISTERED: "proveedor registrado",
  ACTIVATION_SUBMITTED: "activación enviada",
};

/** Spanish labels for grant-source kinds (fallback: humanized token). */
const GRANT_SOURCE_LABELS: Record<string, string> = {
  document: "EXTRACCIÓN",
  manual_grant: "CONCESIÓN MANUAL",
  waiver: "EXENCIÓN",
  determination: "DETERMINACIÓN DE COBERTURA",
  api_check: "VERIFICACIÓN POR API",
};

/** Spanish labels for status-transition sources (fallback: raw token). */
const TRANSITION_SOURCE_LABELS: Record<string, string> = {
  gate: "sistema",
  sweep: "barrido automático",
  officer_decision: "decisión del oficial",
  officer_reclassify: "recategorización del oficial",
  officer: "oficial",
  vendor: "proveedor",
  system: "sistema",
};

// ── Doc actions (shared by Documents + Traceability tabs) ────────────────────

function DocRow({
  doc,
  pill,
}: {
  doc: ExistingVendorDocProjection;
  pill: VendorDocumentPill;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidateVendorData();
  const [dialog, setDialog] = useState<"waive" | "reclassify" | "grant" | null>(null);
  const [revokeCategory, setRevokeCategory] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const retryMutation = useMutation(
    trpc.retryDocumentProcessing.mutationOptions({
      onSuccess: () => invalidate(),
    }),
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/80 bg-card p-3 transition-[border-color,box-shadow] duration-200 hover:border-primary/20 hover:shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{doc.fileName}</p>
          <p className="text-xs text-muted-foreground">
            {doc.extraction
              ? vendorDocumentTypeTitle(doc.extraction.documentType)
              : "Sin clasificar"}
            {doc.extractedExpirationDate
              ? ` · vence el ${formatDate(doc.extractedExpirationDate)}`
              : ""}
          </p>
        </div>
        <DocPill pill={pill} />
      </div>

      {doc.failureReason ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          {doc.failureReason}
        </p>
      ) : null}

      {(doc.extraction?.requirementsGranted ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {doc.extraction!.requirementsGranted.map((c) => (
            <Badge key={c} variant="success" className="text-[11px]">
              {requirementCategoryLabel(c)}
            </Badge>
          ))}
        </div>
      ) : null}
      {(doc.manualGrants ?? []).map((grant) => (
        <div key={grant.category} className="flex items-center gap-2">
          <Badge variant="success" className="text-[11px]">
            {requirementCategoryLabel(grant.category)} (otorgado manualmente)
          </Badge>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setRevokeCategory(grant.category)}>
            Revocar
          </Button>
        </div>
      ))}
      {doc.waiverActive ? (
        <p className="text-xs text-success">
          Eximido para {(doc.waiverScopedCategories ?? []).map((c) => requirementCategoryLabel(c)).join(", ")}
          {doc.waiverExpiresAt ? ` hasta el ${formatDate(doc.waiverExpiresAt)}` : ""}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Icon-only: the aria-label carries the filename so each row's
            viewer button reads uniquely to screen readers. */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setViewerOpen(true)}
          aria-label={`Ver ${doc.fileName}`}
          title="Ver documento"
        >
          <EyeIcon className="h-3.5 w-3.5" />
        </Button>
        {doc.extraction ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setDialog("waive")}>
              {doc.waiverActive ? "Exención…" : "Eximir…"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("reclassify")}>
              Recategorizar…
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => setDialog("grant")}>
          Otorgar manualmente…
        </Button>
        {doc.uploadStatus === "FAILED" || doc.uploadStatus === "ERROR" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={retryMutation.isPending}
            onClick={() => retryMutation.mutate({ vendorDocumentUuid: doc.documentUuid })}
          >
            {retryMutation.isPending ? <Loader className="h-3 w-3 text-current" /> : null}
            Reintentar procesamiento
          </Button>
        ) : null}
      </div>
      <ErrorLine error={retryMutation.error} />

      <DocumentViewerDialog
        doc={doc}
        pill={pill}
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />

      <WaiveDialog doc={doc} open={dialog === "waive"} onClose={() => setDialog(null)} />
      <ReclassifyDialog doc={doc} open={dialog === "reclassify"} onClose={() => setDialog(null)} />
      <GrantDialog doc={doc} open={dialog === "grant"} onClose={() => setDialog(null)} />
      {revokeCategory ? (
        <RevokeDialog
          doc={doc}
          category={revokeCategory}
          open
          onClose={() => setRevokeCategory(null)}
        />
      ) : null}
    </div>
  );
}

// ── The detail page ──────────────────────────────────────────────────────────

const TABS = ["overview", "documents", "traceability"] as const;
type Tab = (typeof TABS)[number];

/** Typed tab labels — an added tab fails type-check instead of mislabeling. */
const TAB_LABELS: Record<Tab, string> = {
  overview: "Resumen",
  documents: "Documentos",
  traceability: "Trazabilidad de requisitos",
};

export function VendorDetail({ vendorUuid }: { vendorUuid: string }) {
  const trpc = useTRPC();
  const [tab, setTab] = useState<Tab>("traceability");
  const vendorQuery = useQuery(
    trpc.getVendor.queryOptions({ vendorUuid }, { refetchInterval: 15_000 }),
  );
  const traceabilityQuery = useQuery(
    trpc.requirementTraceability.queryOptions(
      { vendorUuid },
      { refetchInterval: 15_000 },
    ),
  );
  const finalizeMutation = useMutation(trpc.finalizeStatus.mutationOptions());
  const invalidate = useInvalidateVendorData();

  // The every-surface coverage kick (§8.5): one POST per false→true
  // determining transition, deduped per vendor per mount. A failed kick
  // unlatches so the next 15s refetch retries it.
  const kickedRef = useRef(false);
  const determining = traceabilityQuery.data?.summary.coverage.determining ?? false;
  const summaryData = traceabilityQuery.data?.summary;
  useEffect(() => {
    if (determining && !kickedRef.current) {
      kickedRef.current = true;
      fetch("/api/vendor/admin/coverage-determination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorUuid }),
      })
        .then((res) => {
          if (!res.ok) kickedRef.current = false;
        })
        .catch(() => {
          kickedRef.current = false;
        });
    }
    if (!determining) kickedRef.current = false;
  }, [determining, vendorUuid, summaryData]);

  const summary = traceabilityQuery.data?.summary;
  const documents = traceabilityQuery.data?.documents ?? [];
  const now = new Date();
  // ONE derivation, passed down — children never re-derive.
  const pillByUuid = new Map(
    documents.map((doc) => [doc.documentUuid, deriveVendorDocumentStatus(doc, now)]),
  );

  if (vendorQuery.isError || traceabilityQuery.isError) {
    // A bad or foreign uuid is a terminal NOT_FOUND — an endless skeleton
    // here read as a hang (SPEC §17 C4).
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
        <Link href="/vendors" className="text-sm text-muted-foreground hover:text-foreground">
          ← Directorio
        </Link>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <p role="alert" className="text-sm font-medium text-destructive">
            No se pudo cargar este proveedor.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Es posible que el enlace esté desactualizado o que el proveedor pertenezca a otra organización.
          </p>
        </div>
      </div>
    );
  }

  if (!vendorQuery.data || !summary) {
    // Layout skeleton instead of a full-viewport spinner: header, tab ghost
    // row, two ghost cards — the page shape appears before the data does.
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-col gap-2">
          <Shimmer className="h-3 w-16" />
          <Shimmer className="h-6 w-64 max-w-full" />
          <Shimmer className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-4 border-b pb-2">
          <Shimmer className="h-6 w-20" />
          <Shimmer className="h-6 w-24" />
          <Shimmer className="h-6 w-44" />
        </div>
        <Shimmer className="h-36 w-full rounded-lg" />
        <Shimmer className="h-56 w-full rounded-lg" />
        <p role="status" className="sr-only">
          Cargando proveedor…
        </p>
      </div>
    );
  }
  const vendor = vendorQuery.data.vendor;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <Link
            href="/vendors"
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            ← Directorio
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">{vendor.legalName}</h1>
          <p className="text-sm text-muted-foreground">
            {vendor.dbaName ? `dba ${vendor.dbaName} · ` : ""}
            Perfil {vendorQuery.data.profileName}
            {vendor.tinLast4 ? ` · TIN ••-•••${vendor.tinLast4}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <VendorStatusBadge status={vendor.complianceStatus} />
          {determining ? (
            <Badge variant="agent" className="animate-fade-in text-[11px]">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              Revisión de cobertura
            </Badge>
          ) : null}
        </div>
      </header>

      <nav
        className="flex gap-1 overflow-x-auto border-b"
        role="tablist"
        aria-label="Pestañas del proveedor"
        onKeyDown={(e) => {
          // Tab semantics obligate the ARIA tabs keyboard model: arrows move
          // selection (roving tabindex), Home/End jump to the ends.
          const i = TABS.indexOf(tab);
          const next =
            e.key === "ArrowRight"
              ? TABS[(i + 1) % TABS.length]
              : e.key === "ArrowLeft"
                ? TABS[(i - 1 + TABS.length) % TABS.length]
                : e.key === "Home"
                  ? TABS[0]
                  : e.key === "End"
                    ? TABS[TABS.length - 1]
                    : null;
          if (!next) return;
          e.preventDefault();
          setTab(next);
          document.getElementById(`vendor-tab-${next}`)?.focus();
        }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`vendor-tab-${t}`}
            tabIndex={tab === t ? 0 : -1}
            aria-selected={tab === t}
            // Panels mount conditionally — only the selected tab's IDREF exists.
            aria-controls={tab === t ? `vendor-panel-${t}` : undefined}
            className={cn(
              "relative shrink-0 whitespace-nowrap rounded-t-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              tab === t
                ? "font-medium text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary transition-all duration-300",
                tab === t ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0",
              )}
            />
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div
          role="tabpanel"
          id="vendor-panel-overview"
          aria-labelledby="vendor-tab-overview"
          className="animate-fade-in grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Finalizar estado de cumplimiento</CardTitle>
              <p className="text-xs text-muted-foreground">
                APROBADO habilita la acción de sincronización con el ERP (explícita, nunca automática).
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(["PRE_APPROVED", "NEED_REVIEW", "APPROVED", "REJECTED"] as const).map(
                (status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={status === "APPROVED" ? "success" : status === "REJECTED" ? "destructive" : "outline"}
                    disabled={finalizeMutation.isPending || vendor.complianceStatus === status}
                    onClick={() =>
                      finalizeMutation.mutate(
                        { vendorUuid, status },
                        { onSuccess: () => invalidate() },
                      )
                    }
                  >
                    {finalizeMutation.isPending &&
                    finalizeMutation.variables?.status === status ? (
                      <Loader className="h-3.5 w-3.5 text-current" />
                    ) : null}
                    {vendorStatusLabel(status)}
                  </Button>
                ),
              )}
              {finalizeMutation.error ? (
                <p role="alert" className="w-full text-xs text-destructive">
                  {finalizeMutation.error.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Actividad</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1.5">
                {vendorQuery.data.activity.map((entry) => (
                  <li key={entry.id} className="flex items-baseline gap-2 text-xs">
                    <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatDate(entry.createdAt)}
                    </span>
                    <span className="font-medium">
                      {ACTIVITY_LABELS[entry.type] ?? entry.type.replaceAll("_", " ").toLowerCase()}
                    </span>
                  </li>
                ))}
                {vendorQuery.data.activity.length === 0 ? (
                  <li className="text-xs text-muted-foreground">Aún no hay actividad.</li>
                ) : null}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Transiciones de estado</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1.5">
                {vendorQuery.data.transitions.map((t) => (
                  <li key={t.id} className="text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatDate(t.createdAt)}</span>:{" "}
                    {vendorStatusLabel(t.fromStatus)} → {vendorStatusLabel(t.toStatus)} ({TRANSITION_SOURCE_LABELS[t.source] ?? t.source})
                  </li>
                ))}
                {vendorQuery.data.transitions.length === 0 ? (
                  <li className="text-xs text-muted-foreground">Aún no hay transiciones de estado.</li>
                ) : null}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "documents" ? (
        <div
          role="tabpanel"
          id="vendor-panel-documents"
          aria-labelledby="vendor-tab-documents"
          className="animate-fade-in flex flex-col gap-2"
        >
          {documents.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Aún no se han subido documentos.
            </p>
          ) : (
            documents.map((doc) => (
              <DocRow
                key={doc.documentUuid}
                doc={doc}
                pill={pillByUuid.get(doc.documentUuid) ?? "processing"}
              />
            ))
          )}
        </div>
      ) : null}

      {tab === "traceability" ? (
        <div
          role="tabpanel"
          id="vendor-panel-traceability"
          aria-labelledby="vendor-tab-traceability"
          className="animate-fade-in flex flex-col gap-3"
        >
          {summary.coverage.summarySource !== "none" || summary.coverage.determining ? (
            <Card
              className={cn(
                summary.coverage.determining &&
                  "border-agent/30 bg-agent/5 shadow-glow-agent",
              )}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                  Determinación de cobertura
                  {summary.coverage.determining ? (
                    <Badge variant="agent" className="animate-fade-in text-[11px]">
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
                      />
                      En vivo
                    </Badge>
                  ) : null}
                  <Badge variant={summary.coverage.summarySource === "fresh" ? "success" : "muted"} className="text-[11px]">
                    {summary.coverage.summarySource === "fresh"
                      ? "Actual"
                      : summary.coverage.summarySource === "stale"
                        ? "Actualizando"
                        : "Pendiente"}
                  </Badge>
                </CardTitle>
                {summary.coverage.determining ? (
                  <TextShimmer className="text-xs">
                    El agente está revisando los límites de póliza acumulados…
                  </TextShimmer>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5">
                {(summary.coverage.lines ?? []).map((line) => (
                  <div key={line.category} className="flex flex-col gap-0.5 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">
                        {LINE_LABELS[line.category] ??
                          line.category
                            .replaceAll("_", " ")
                            .toLowerCase()
                            .replace(/^./, (c) => c.toUpperCase())}
                      </span>
                      <Badge
                        variant={(VERDICT_BADGES[line.verdict] ?? VERDICT_BADGES.UNDETERMINED).variant}
                        className="text-[11px]"
                      >
                        {(VERDICT_BADGES[line.verdict] ?? VERDICT_BADGES.UNDETERMINED).label}
                      </Badge>
                      <span className="tabular-nums text-muted-foreground">
                        {formatUsd(line.effectiveOccurrenceLimitUsd)} de{" "}
                        {formatUsd(summary.coverage.requiredLimits[line.category] ?? null)} requeridos
                      </span>
                    </div>
                    <p className="text-muted-foreground">{line.reasoning}</p>
                  </div>
                ))}
                {summary.coverage.determining &&
                (summary.coverage.lines ?? []).length === 0 ? (
                  <div aria-hidden className="flex flex-col gap-2">
                    <Shimmer className="h-3.5 w-3/4" />
                    <Shimmer className="h-3.5 w-2/3" />
                    <Shimmer className="h-3.5 w-1/2" />
                  </div>
                ) : null}
                {summary.coverage.narrative ? (
                  <p className="text-xs text-muted-foreground">{summary.coverage.narrative}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {summary.categories.map((category) => {
            const docsFor = (uuids: string[]) =>
              uuids
                .map((uuid) => documents.find((d) => d.documentUuid === uuid))
                .filter((d): d is ExistingVendorDocProjection => Boolean(d));
            const granting = docsFor(category.grantingDocumentUuids);
            const failed = docsFor(category.failedDocumentUuids);
            const contributing = docsFor(category.contributingDocumentUuids);
            const expiredDocs = docsFor(category.expiredGrantingDocumentUuids);
            const shown = new Set<string>();
            const rows = [...granting, ...contributing, ...expiredDocs, ...failed].filter(
              (d) => !shown.has(d.documentUuid) && shown.add(d.documentUuid),
            );
            const total = rows.length;
            return (
              <Card
                key={category.category}
                className={cn(category.dismissed && "border-dashed bg-muted/40")}
              >
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <span
                        aria-hidden
                        className={cn(
                          category.granted
                            ? "text-success"
                            : category.determining
                              ? "text-muted-foreground"
                              : category.dismissed
                                ? "text-muted-foreground"
                                : failed.length > 0
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                        )}
                      >
                        {category.granted ? "✓" : category.determining ? "…" : category.dismissed ? "—" : total === 0 ? "○" : "✕"}
                      </span>
                      {category.label}
                      {category.mandatory ? (
                        <span className="text-[11px] uppercase text-muted-foreground">Requisito obligatorio</span>
                      ) : null}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {category.grantSources.map((source, i) => (
                        <Badge key={`${source.kind}-${i}`} variant="outline" className="text-[11px]">
                          {GRANT_SOURCE_LABELS[source.kind] ?? source.kind.replaceAll("_", " ")}
                        </Badge>
                      ))}
                      {category.dismissed ? (
                        <Badge variant="muted" className="text-[11px]">
                          No aplica
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {category.expiresAt ? (
                    <p className="text-xs tabular-nums text-muted-foreground">
                      Vence el {formatDate(category.expiresAt)}
                    </p>
                  ) : null}
                  {category.determining ? (
                    <TextShimmer className="text-xs">Revisión de cobertura en curso…</TextShimmer>
                  ) : null}
                </CardHeader>
                {rows.length > 0 ? (
                  <CardContent className="flex flex-col gap-2">
                    {rows.map((doc) => (
                      <DocRow
                        key={doc.documentUuid}
                        doc={doc}
                        pill={pillByUuid.get(doc.documentUuid) ?? "processing"}
                      />
                    ))}
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
