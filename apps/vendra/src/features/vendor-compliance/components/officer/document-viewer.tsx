"use client";

/**
 * The officer document viewer (SPEC §8.2) — the actual uploaded file
 * rendered inline beside its full processing record. The preview and the
 * download are both presigned GETs against this app's own MinIO/S3 bucket
 * (inline vs attachment disposition) — no external viewer service, nothing
 * leaves the container network.
 *
 * Layout: two panes on lg+ (file left, record right; the record pane
 * scrolls independently), stacked on phone/tablet with a shorter preview.
 */
import { useQuery } from "@tanstack/react-query";

import { Badge, Button, Dialog, Loader, Shimmer } from "@/components/ui/primitives";
import { useTRPC } from "@/lib/trpc-client";
import { cn, formatDate } from "@/lib/utils";
import { requirementCategoryLabel, vendorDocumentTypeTitle } from "@vendra/workflow/vendor";

import type { ExistingVendorDocProjection } from "../../lib/vendor-harness-contract";
import type { VendorDocumentPill } from "./doc-status";
import { DocPill } from "./doc-status";

function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Extension fallback for objects stored before mime metadata existed. */
function inferMime(fileName: string): string | null {
  const ext = fileName.toLowerCase().split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    default:
      return null;
  }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

export function DocumentViewerDialog({
  doc,
  pill,
  open,
  onClose,
}: {
  doc: ExistingVendorDocProjection;
  pill: VendorDocumentPill;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const downloadQuery = useQuery(
    trpc.documentDownloadUrl.queryOptions(
      { documentUuid: doc.documentUuid },
      { enabled: open, staleTime: 60_000 },
    ),
  );

  if (!open) return null;

  const links = downloadQuery.data;
  const mime = links?.mimeType ?? inferMime(doc.fileName);
  const extraction = doc.extraction;
  const rules = extraction?.validationRules ?? [];
  const passed = rules.filter((r) => !r.informational && r.passed).length;
  const failed = rules.filter((r) => !r.informational && !r.passed).length;
  const informational = rules.filter((r) => r.informational).length;
  const fileSize = formatBytes(doc.fileSizeBytes);

  return (
    <Dialog open={open} onClose={onClose} title={doc.fileName} className="max-w-6xl">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* ── File pane ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2.5">
          <div className="relative h-[38vh] overflow-hidden rounded-md border bg-muted/40 lg:h-[62vh]">
            {links ? (
              mime?.startsWith("image/") ? (
                <img
                  src={links.previewUrl}
                  alt={`Preview of ${doc.fileName}`}
                  className="h-full w-full object-contain"
                />
              ) : mime === "application/pdf" ? (
                <iframe
                  src={links.previewUrl}
                  title={`Preview of ${doc.fileName}`}
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center">
                  <p className="text-sm font-medium">No inline preview for this file type</p>
                  <p className="text-xs text-muted-foreground">
                    Download the original below to open it locally.
                  </p>
                </div>
              )
            ) : downloadQuery.isError ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <p role="alert" className="text-sm text-destructive">
                  The document preview could not be loaded.
                </p>
                <Button size="sm" variant="outline" onClick={() => void downloadQuery.refetch()}>
                  Try again
                </Button>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6">
                <Shimmer className="h-4/5 w-11/12 rounded-md" />
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader className="h-3.5 w-3.5" /> Loading the document…
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Hard invariant (§8.2): every doc viewable AND downloadable. */}
            <a
              href={links?.downloadUrl}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-soft transition-opacity hover:opacity-90",
                !links && "pointer-events-none opacity-50",
              )}
              aria-disabled={!links}
            >
              Download file
            </a>
            <a
              href={links?.previewUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted",
                !links && "pointer-events-none opacity-50",
              )}
              aria-disabled={!links}
            >
              Open in new tab
            </a>
            <span className="text-xs text-muted-foreground">
              {[mime, fileSize].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>

        {/* ── Processing record pane ────────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:max-h-[66vh] lg:overflow-y-auto lg:pr-1">
          <section className="flex flex-col gap-2">
            <SectionTitle>Status</SectionTitle>
            <div className="flex flex-wrap items-center gap-2">
              <DocPill pill={pill} />
              {doc.extractedExpirationDate ? (
                <span className="text-xs text-muted-foreground">
                  Expires {formatDate(doc.extractedExpirationDate)}
                </span>
              ) : null}
            </div>
            {doc.failureReason ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                {doc.failureReason}
              </p>
            ) : null}
            {(doc.additionalEntityNames ?? []).length > 0 ? (
              <p className="rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
                This file also contains documents for:{" "}
                {doc.additionalEntityNames!.join(", ")}.
              </p>
            ) : null}
          </section>

          {extraction ? (
            <section className="flex flex-col gap-1.5">
              <SectionTitle>Classification</SectionTitle>
              <p className="text-sm font-medium">
                {vendorDocumentTypeTitle(extraction.documentType)}
                {extraction.documentSubtype ? (
                  <span className="text-muted-foreground"> · {extraction.documentSubtype}</span>
                ) : null}
                {extraction.classificationConfidence !== null ? (
                  // The "· " is a real text node (SPEC §17 C13) — without it
                  // screen readers concatenate "IRS Form W-9" + "99%…" into
                  // "W-999% confidence".
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    · {Math.round(extraction.classificationConfidence * 100)}% confidence
                  </span>
                ) : null}
              </p>
              {extraction.classificationReasoning ? (
                <p className="text-xs text-muted-foreground">
                  {extraction.classificationReasoning}
                </p>
              ) : null}
            </section>
          ) : (
            <section className="flex flex-col gap-1.5">
              <SectionTitle>Classification</SectionTitle>
              <p className="text-sm text-muted-foreground">
                Not classified yet — the document has no extraction.
              </p>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <SectionTitle>Requirements</SectionTitle>
            {(extraction?.requirementsGranted ?? []).length > 0 ||
            (doc.manualGrants ?? []).length > 0 ||
            (doc.scopedCategories ?? []).length > 0 ||
            doc.waiverActive ? (
              <div className="flex flex-col gap-1.5">
                {(extraction?.requirementsGranted ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {extraction!.requirementsGranted.map((c) => (
                      <Badge key={c} variant="success" className="text-[11px]">
                        {requirementCategoryLabel(c)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {(doc.manualGrants ?? []).map((grant) => (
                  <div key={grant.category} className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="success" className="text-[11px]">
                      {requirementCategoryLabel(grant.category)} (manually granted)
                    </Badge>
                    {grant.grantedAt ? (
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(grant.grantedAt)}
                      </span>
                    ) : null}
                  </div>
                ))}
                {(doc.scopedCategories ?? []).length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Counted toward coverage despite the failure:{" "}
                    {doc.scopedCategories!.map((c) => requirementCategoryLabel(c)).join(", ")}.
                  </p>
                ) : null}
                {doc.waiverActive ? (
                  <p className="text-xs text-success">
                    Waived for{" "}
                    {(doc.waiverScopedCategories ?? [])
                      .map((c) => requirementCategoryLabel(c))
                      .join(", ")}
                    {doc.waiverExpiresAt ? ` until ${formatDate(doc.waiverExpiresAt)}` : ""}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No requirements are granted by this document.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <SectionTitle>Extracted fields</SectionTitle>
            {extraction && Object.keys(extraction.extractedData).length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(extraction.extractedData)
                      .filter(([, v]) => v !== null && v !== "")
                      .map(([key, value]) => {
                        const confidence = extraction.fieldConfidences?.[key];
                        return (
                          <tr key={key} className="border-b last:border-b-0">
                            <td className="whitespace-nowrap px-2 py-1 align-top font-medium text-muted-foreground">
                              {key.replaceAll("_", " ")}
                            </td>
                            <td className="break-words px-2 py-1">
                              {key.endsWith("_last4")
                                ? `••-•••${String(value)}`
                                : typeof value === "object"
                                  ? JSON.stringify(value, null, 1)
                                  : String(value)}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1 text-right align-top text-[11px] text-muted-foreground">
                              {typeof confidence === "number"
                                ? `${Math.round(confidence * 100)}%`
                                : ""}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No extracted fields yet.</p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <SectionTitle>Validation</SectionTitle>
            {rules.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {passed} passed · {failed} failed · {informational} informational
                </p>
                <ul className="flex flex-col gap-1">
                  {rules.map((rule) => (
                    <li
                      key={rule.rule}
                      className={cn(
                        "text-xs",
                        rule.informational
                          ? "text-warning"
                          : rule.passed
                            ? "text-success"
                            : "text-destructive",
                      )}
                    >
                      <span className="sr-only">
                        {rule.informational
                          ? "Informational: "
                          : rule.passed
                            ? "Passed: "
                            : "Failed: "}
                      </span>
                      <span aria-hidden>
                        {rule.informational ? "⚠" : rule.passed ? "✓" : "✕"}
                      </span>{" "}
                      {rule.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No validation results yet.</p>
            )}
          </section>
        </div>
      </div>
    </Dialog>
  );
}
