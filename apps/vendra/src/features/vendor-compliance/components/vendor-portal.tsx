"use client";

/**
 * The vendor portal (SPEC §7): registration → requirement checklist →
 * upload → live processing cards → HITL → coverage readout → activation
 * gate. Left column = dropzone + document cards; right aside = category
 * list + coverage + activate.
 */
import { CheckIcon, ClockIcon, CloudUploadIcon, FileTextIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import { cn, formatDate } from "@/lib/utils";

import type { ComplianceSummaryPayload } from "@/server/compliance-summary";

import { useComplianceSummary } from "../hooks/use-compliance-summary";
import { useCoverageProgress } from "../hooks/use-coverage-progress";
import { useDocumentsController } from "../hooks/use-documents-controller";
import type { ExistingVendorDocProjection } from "../lib/vendor-harness-contract";
import { VendorStatusBadge } from "./vendor-status-badge";
import { DocCard } from "./doc-card";
import { DocumentProcessor } from "./document-processor";
import { AssistantPanel } from "./assistant/assistant-panel";
import { RequirementAside } from "./requirement-aside";

function RegistrationForm({
  summary,
  onSaved,
}: {
  summary: ComplianceSummaryPayload;
  onSaved: () => void;
}) {
  const [legalName, setLegalName] = useState(summary.vendor.legalName);
  const [dbaName, setDbaName] = useState(summary.vendor.dbaName ?? "");
  const [entityType, setEntityType] = useState(summary.vendor.entityType ?? "");
  const [naicsCode, setNaicsCode] = useState(summary.vendor.naicsCode ?? "");
  const [states, setStates] = useState((summary.vendor.workProfile.states ?? []).join(", "));
  const [remoteOnly, setRemoteOnly] = useState(summary.vendor.workProfile.remoteOnly === true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statesHint, setStatesHint] = useState<string | null>(null);

  // Any edit invalidates the "Saved" chip so it always reflects the persisted state.
  function edit<T>(setter: (v: T) => void) {
    return (v: T) => {
      setSaved(false);
      setter(v);
    };
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    const statesAtSave = states;
    const rawTokens = states
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const parsedStates = [
      ...new Set(rawTokens.map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s))),
    ];
    const dropped = rawTokens.filter((s) => !/^[A-Za-z]{2}$/.test(s));
    setStatesHint(
      dropped.length > 0 ? `Ignored: ${dropped.join(", ")} — use 2-letter state codes.` : null,
    );
    try {
      const res = await fetch("/api/vendor/registration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName,
          dbaName: dbaName || null,
          entityType: entityType || null,
          naicsCode: naicsCode || null,
          workProfile: {
            remoteOnly,
            onSite: !remoteOnly,
            states: parsedStates,
          },
          registered: true,
        }),
      });
      if (res.ok) {
        setSaved(true);
        // Re-sync to the normalized value ONLY if the user hasn't kept
        // typing while the PATCH was in flight.
        setStates((current) =>
          current === statesAtSave ? parsedStates.join(", ") : current,
        );
        onSaved();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setSaveError(body?.error ?? "Your details could not be saved — try again.");
      }
    } catch {
      setSaveError("Your details could not be saved — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Business details</CardTitle>
        <p className="text-xs text-muted-foreground">
          These drive your requirement profile — remote-only vendors skip auto and workers'-comp
          coverage. Your EIN is never typed here: it's verified from your W-9.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reg-legal">Legal name</Label>
          <Input id="reg-legal" value={legalName} onChange={(e) => edit(setLegalName)(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reg-dba">DBA / trade name</Label>
          <Input id="reg-dba" value={dbaName} onChange={(e) => edit(setDbaName)(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reg-entity">Entity type</Label>
          <Input
            id="reg-entity"
            placeholder="LLC, S-Corp, sole proprietor…"
            value={entityType}
            onChange={(e) => edit(setEntityType)(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reg-naics">NAICS code</Label>
          <Input id="reg-naics" value={naicsCode} onChange={(e) => edit(setNaicsCode)(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reg-states">Work states (2-letter, comma-separated)</Label>
          <Input
            id="reg-states"
            placeholder="VA, MD, DC"
            value={states}
            onChange={(e) => edit(setStates)(e.target.value)}
          />
          {statesHint ? <p className="text-xs text-warning">{statesHint}</p> : null}
        </div>
        <div className="flex items-end gap-2 pb-1">
          <input
            id="reg-remote"
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-primary"
            checked={remoteOnly}
            onChange={(e) => edit(setRemoteOnly)(e.target.checked)}
          />
          <Label htmlFor="reg-remote">Remote-only (no on-site work)</Label>
        </div>
        {summary.vendor.tinLast4 ? (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Tax ID on file: ••-•••{summary.vendor.tinLast4} (from your verified W-9)
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <Button size="sm" onClick={() => void save()} disabled={saving || legalName.trim() === ""}>
            {saving ? "Saving…" : "Save details"}
          </Button>
          {saved ? (
            <span
              role="status"
              className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-success animate-fade-in"
            >
              <CheckIcon aria-hidden className="h-3.5 w-3.5" />
              Saved
            </span>
          ) : null}
          {saveError ? (
            <p role="alert" className="mt-1.5 text-xs text-destructive animate-fade-in">
              {saveError}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function VendorPortal({
  initialSummary,
  initialDocuments,
  verbose,
}: {
  initialSummary: ComplianceSummaryPayload;
  initialDocuments: ExistingVendorDocProjection[];
  verbose: boolean;
}) {
  const router = useRouter();
  const { summary, refresh: refreshSummary } = useComplianceSummary(initialSummary);
  const controller = useDocumentsController({
    initialDocuments,
    onSettled: () => void refreshSummary(),
  });
  // Live determination progress — attach-only stream, transient parts (§7.4).
  const coverageProgress = useCoverageProgress({
    determining: summary.coverage.determining,
    onSettled: () => void refreshSummary(),
  });
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Dropzone drag lifecycle — visual state only; dragenter/dragleave fire on
  // children too, so a depth counter keeps the highlight steady.
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  const onToggleDismiss = useCallback(
    async (category: string, dismissed: boolean) => {
      setTogglePending(true);
      setToggleError(null);
      const current = new Set(summary.dismissedCategories);
      if (dismissed) current.add(category);
      else current.delete(category);
      try {
        const res = await fetch("/api/vendor/registration", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dismissedCategories: [...current] }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setToggleError(body?.error ?? "The change could not be saved — try again.");
        }
        await refreshSummary();
      } catch {
        setToggleError("The change could not be saved — check your connection and try again.");
      } finally {
        setTogglePending(false);
      }
    },
    [summary.dismissedCategories, refreshSummary],
  );

  const onActivate = useCallback(async () => {
    setActivating(true);
    setActivateError(null);
    try {
      const res = await fetch("/api/vendor/activate", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setActivateError(body?.error ?? "Activation failed — try again.");
      }
      await refreshSummary();
    } catch {
      setActivateError("Activation failed — check your connection and try again.");
    } finally {
      setActivating(false);
    }
  }, [refreshSummary]);

  const processingCount = controller.docs.filter(
    (d) =>
      d.status === "PROCESSING" ||
      d.status === "UPLOADING" ||
      d.status === "QUEUED" ||
      d.status === "UPLOADED" ||
      // A stale in-flight server row doesn't count once this tab's own
      // stream has already reached a terminal (SPEC §17 C2) — the refresh
      // is converging it, and a phantom count blocks the activate button.
      (d.server &&
        ["PROCESSING", "UPLOADED", "PENDING"].includes(d.server.uploadStatus) &&
        !d.liveVM?.terminal &&
        d.liveVM?.status !== "ERROR"),
  ).length;
  const hasDocumentsProcessing = processingCount > 0;

  // Renewal banner (spec §16 B7): surface the earliest lapse when it's near.
  const renewalDueDate = (() => {
    if (!summary.nextExpiryAt) return null;
    const due = new Date(`${summary.nextExpiryAt.slice(0, 10)}T00:00:00Z`).getTime();
    const days = Math.ceil((due - Date.now()) / 86_400_000);
    return days >= 0 && days <= 30 ? summary.nextExpiryAt : null;
  })();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-4 md:p-6 xl:max-w-7xl">
      {/* Sticky glass bar — negative margins bleed it across the page padding
          so the badge + sign-out stay visible on long document lists. */}
      <header className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 bg-card/70 px-4 py-3 backdrop-blur-xl md:-mx-6 md:-mt-6 md:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold sm:text-lg">
            {summary.vendor.legalName}
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Vendor compliance onboarding
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <VendorStatusBadge status={summary.vendor.complianceStatus} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void authClient
                .signOut()
                .catch(() => undefined)
                .then(() => {
                  router.push("/login");
                  router.refresh();
                })
            }
          >
            Sign out
          </Button>
        </div>
      </header>

      {renewalDueDate ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning animate-fade-in-up"
        >
          <ClockIcon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Your earliest credential lapses {formatDate(renewalDueDate)} — upload a renewal
            before then to stay compliant.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row xl:gap-6">
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <RegistrationForm summary={summary} onSaved={() => void refreshSummary()} />

          <Card className="bg-gradient-to-b from-primary/[0.03] to-transparent">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Compliance documents</CardTitle>
              <p className="text-xs text-muted-foreground">
                Upload your COI, W-9, licenses, and anything else — PNG, JPEG, WebP, or PDF, up
                to 10 MB each. Each document streams live through classification, extraction, and
                validation.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <button
                type="button"
                className={cn(
                  "flex min-h-24 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-4 text-sm transition-all duration-200",
                  dragActive
                    ? "scale-[1.01] border-agent bg-agent/5 text-agent"
                    : "border-input text-muted-foreground hover:border-agent hover:text-agent",
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(e) => {
                  e.preventDefault();
                  dragDepth.current += 1;
                  setDragActive(true);
                }}
                onDragLeave={() => {
                  dragDepth.current = Math.max(0, dragDepth.current - 1);
                  if (dragDepth.current === 0) setDragActive(false);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dragDepth.current = 0;
                  setDragActive(false);
                  void controller.addFiles([...e.dataTransfer.files]);
                }}
              >
                <CloudUploadIcon
                  aria-hidden
                  className={cn("h-5 w-5", dragActive ? "animate-pulse" : "")}
                />
                <span className="font-medium">
                  {dragActive ? "Release to upload" : "Drop files here or click to upload"}
                </span>
                <span className="text-xs">Certificates of insurance, W-9, licenses, agreements…</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  void controller.addFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />

              {controller.intakeErrors.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 animate-fade-in-up"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-destructive">Invalid files</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={controller.clearIntakeErrors}
                    >
                      Dismiss
                    </Button>
                  </div>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {controller.intakeErrors.map((err, i) => (
                      <p key={`${err.fileName}-${i}`} className="text-xs text-destructive">
                        <span className="font-medium">{err.fileName}</span>: {err.reason}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                {controller.docs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-dots px-4 py-8 text-center animate-fade-in">
                    <span
                      aria-hidden
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-agent/20 bg-agent/5 text-agent"
                    >
                      <FileTextIcon className="h-5 w-5" />
                    </span>
                    <p className="text-sm font-medium">No documents yet</p>
                    <p className="max-w-xs text-xs text-muted-foreground">
                      Drop a COI or W-9 in the zone above to start a live review — each document
                      gets its own AI agent session.
                    </p>
                  </div>
                ) : (
                  controller.docs.map((doc) => (
                    <div key={doc.pointer} className="animate-fade-in-up">
                      <DocCard
                        doc={doc}
                        onTryAgain={controller.tryAgain}
                        onRetryUpload={controller.retryUpload}
                        onDelete={(pointer) => void controller.deleteDoc(pointer)}
                        verbose={verbose}
                      />
                    </div>
                  ))
                )}
              </div>

              {/* Headless stream drivers — one per live PROCESSING doc. */}
              {controller.docs
                .filter((d) => d.status === "PROCESSING" && d.documentUuid)
                .map((doc) => (
                  <DocumentProcessor
                    key={`${doc.pointer}#${doc.retryNonce}`}
                    pointer={doc.pointer}
                    documentUuid={doc.documentUuid!}
                    retryNonce={doc.retryNonce}
                    onVM={controller.onDocVM}
                    onTerminal={controller.onDocTerminal}
                  />
                ))}

              <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                <Button size="sm" variant="ghost" onClick={() => void controller.refresh()}>
                  Refresh
                </Button>
                {hasDocumentsProcessing ? (
                  <span role="status" className="inline-flex">
                    <Badge variant="agent" className="text-[11px] tabular-nums">
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current"
                      />
                      Processing {processingCount === 1 ? "1 document" : `${processingCount} documents`}…
                    </Badge>
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </main>

        <RequirementAside
          summary={summary}
          coverageProgress={coverageProgress}
          onToggleDismiss={(c, d) => void onToggleDismiss(c, d)}
          togglePending={togglePending}
          toggleError={toggleError}
          onActivate={() => void onActivate()}
          activating={activating}
          activateError={activateError}
          hasDocumentsProcessing={hasDocumentsProcessing}
        />
      </div>

      <AssistantPanel />
    </div>
  );
}
