"use client";

/**
 * The right-aside requirement checklist + coverage readout + activation gate
 * (SPEC §7.4). Fresh/stale truthfulness: while re-determining, the last
 * converged figures stay visible under a glass "updating" veil (never a
 * contrast-eroding dim); determining with no prior figures renders the
 * recalculating skeleton.
 */
import { CheckIcon, CircleIcon, MinusIcon } from "lucide-react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Loader, Shimmer } from "@/components/ui/primitives";
import { cn, formatDate, formatUsd } from "@/lib/utils";

import type { ComplianceSummaryPayload, SummaryCategory } from "@/server/compliance-summary";

import type { CoverageProgress } from "../hooks/use-coverage-progress";
import type { CoverageProgressStage } from "../lib/vendor-harness-contract";
import { CollapsibleSection } from "./collapsible-section";

/** Friendly copy for the live determination stages (§6.6 lifecycle). */
const COVERAGE_STAGE_COPY: Record<CoverageProgressStage, string> = {
  queued: "Queued for coverage review…",
  starting: "Starting the coverage review…",
  reviewing: "Reviewing your policies…",
  checking: "Checking limits and umbrella stacking…",
  saving: "Saving the coverage determination…",
  "waiting-for-documents": "Waiting for your other documents to finish…",
  retrying: "Taking another look…",
  converged: "Coverage review complete.",
  unavailable: "The coverage review could not complete.",
};

function CategoryRow({
  category,
  onToggleDismiss,
  togglePending,
  atCap,
}: {
  category: SummaryCategory;
  onToggleDismiss: (category: string, dismissed: boolean) => void;
  togglePending: boolean;
  /** Manual dismissals are at the profile cap — new dismissals are blocked. */
  atCap: boolean;
}) {
  // SVG status icons (platform-stable, unlike unicode glyphs); state flips
  // to a settled verdict scale in. The icons stay decorative (aria-hidden
  // wrapper) — adjacent text carries the state for screen readers.
  const icon =
    category.state === "COMPLETED" ? (
      <CheckIcon className="h-3.5 w-3.5 text-success animate-scale-in" />
    ) : category.state === "DISMISSED" ? (
      <MinusIcon className="h-3.5 w-3.5 text-muted-foreground" />
    ) : category.state === "DETERMINING" ? (
      <Loader className="h-3.5 w-3.5 text-agent" />
    ) : category.state === "PARTIALLY_COMPLETE" ? (
      // Determinate half-ring — "partway there" without font-dependent ◐.
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className="h-3.5 w-3.5 text-warning animate-scale-in"
      >
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1.75A6.25 6.25 0 0 1 8 14.25Z" fill="currentColor" />
      </svg>
    ) : (
      <CircleIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
    );
  const expired = category.expiredGrantingDocumentUuids.length > 0 && !category.granted;
  return (
    <li className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
      <div className="flex min-w-0 items-start gap-2">
        <span aria-hidden className="mt-0.5 flex w-4 shrink-0 justify-center">
          {icon}
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              "text-sm",
              category.state === "DISMISSED" && "text-muted-foreground line-through",
            )}
          >
            {category.label}
            {category.mandatory ? (
              <span className="ml-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                required
              </span>
            ) : null}
          </p>
          {category.state === "DETERMINING" ? (
            <p className="text-xs text-muted-foreground">Reviewing coverage…</p>
          ) : null}
          {expired ? <p className="text-xs text-warning">A granting document expired</p> : null}
          {category.granted && category.expiresAt ? (
            <p className="text-xs text-muted-foreground">
              Valid until {formatDate(category.expiresAt)}
            </p>
          ) : null}
        </div>
      </div>
      {category.autoDismissed ? (
        // Derived from the work profile, not the manual list — a toggle here
        // would be a dead control (flip "Remote-only" off to restore it).
        // Wraps below the label on narrow screens instead of squeezing it.
        <span className="pl-6 text-[11px] text-muted-foreground sm:shrink-0 sm:pl-0 sm:pt-1 sm:text-right">
          Not required for remote-only vendors
        </span>
      ) : category.dismissible && (category.dismissed || !category.granted) ? (
        // A DISMISSED row always offers "Applies to us" even once granted
        // (SPEC §17 C13) — otherwise a later grant hides the toggle while
        // the row keeps consuming a cap slot, deadlocking the other
        // dismissible rows at "un-dismiss one to free a slot".
        <Button
          size="sm"
          variant="ghost"
          className="ml-6 h-6 self-start px-1.5 text-[11px] text-muted-foreground sm:ml-0 sm:shrink-0 sm:self-auto"
          disabled={togglePending || (!category.dismissed && atCap)}
          onClick={() => onToggleDismiss(category.category, !category.dismissed)}
        >
          {category.dismissed ? "Applies to us" : "Not applicable"}
        </Button>
      ) : null}
    </li>
  );
}

function CoverageReadout({
  coverage,
  progress,
}: {
  coverage: ComplianceSummaryPayload["coverage"];
  progress: CoverageProgress;
}) {
  const updating = coverage.determining || coverage.summarySource === "stale";
  if (coverage.summarySource === "none" && !coverage.determining) return null;
  const liveLine =
    coverage.determining && progress.stage
      ? COVERAGE_STAGE_COPY[progress.stage.stage]
      : null;
  return (
    // Live harness lane → agent-accent glow while determining; converged
    // figures arrive with a fade+rise instead of a repaint.
    <Card className={coverage.determining ? "animate-glow-pulse" : "animate-fade-in-up"}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          Insurance coverage review
          {updating ? <Loader className="h-3 w-3 text-agent" /> : null}
        </CardTitle>
        {/* Live progress from the attach-only stream (transient data parts). */}
        {liveLine ? (
          <div className="flex flex-col gap-1" aria-live="polite">
            <p
              key={progress.stage?.stage}
              className="text-xs font-medium text-agent transition-opacity duration-300 animate-fade-in"
            >
              {liveLine}
              {progress.stage?.attempt && progress.stage.attempt > 1
                ? ` (attempt ${progress.stage.attempt})`
                : ""}
            </p>
            {progress.narration ? (
              <blockquote
                key={progress.narration}
                className="border-l-2 border-agent/30 pl-2 text-xs italic text-muted-foreground animate-fade-in"
              >
                “{progress.narration}”
              </blockquote>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {coverage.summarySource === "none" ? (
          <div className="flex flex-col gap-1.5 animate-fade-in">
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-4 w-3/4" />
            <p className="text-xs text-muted-foreground">
              {liveLine ?? "Reviewing your policies…"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <div className="flex flex-col gap-2">
                {(coverage.lines ?? []).map((line) => {
                  const contributions = line.contributions.filter((c) => c.role !== "rejected");
                  return (
                    <div
                      key={line.category}
                      className={cn(
                        "rounded-md border p-2",
                        line.verdict === "MEETS"
                          ? "border-success/20 bg-success/5"
                          : line.verdict === "BELOW"
                            ? "border-destructive/20 bg-destructive/5"
                            : "border-border bg-muted/30",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <p className="text-xs font-medium capitalize">
                          {line.category.replaceAll("_", " ").toLowerCase()}
                        </p>
                        <Badge
                          variant={
                            line.verdict === "MEETS"
                              ? "success"
                              : line.verdict === "BELOW"
                                ? "destructive"
                                : "muted"
                          }
                          className="text-[11px]"
                        >
                          {line.verdict === "MEETS"
                            ? "Meets requirement"
                            : line.verdict === "BELOW"
                              ? "Below requirement"
                              : "Undetermined"}
                        </Badge>
                      </div>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        Effective {formatUsd(line.effectiveOccurrenceLimitUsd)} of{" "}
                        {formatUsd(coverage.requiredLimits[line.category] ?? null)} required
                      </p>
                      {contributions.length > 0 ? (
                        <div className="mt-1 flex flex-col gap-0.5 border-l border-border pl-2">
                          {contributions.map((c) => (
                            <p
                              key={`${c.documentUuid}-${c.role}`}
                              className="text-[11px] tabular-nums text-muted-foreground"
                            >
                              {c.role} policy contributes {formatUsd(c.amountAppliedUsd)}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {coverage.conflicts.length > 0 ? (
                  // Long-form agent notes collapse by default (SPEC §17 C8);
                  // the count in the trigger keeps the signal visible.
                  <CollapsibleSection
                    label="Coverage review notes"
                    summary={`${coverage.conflicts.length} note${coverage.conflicts.length === 1 ? "" : "s"}`}
                    tone="warning"
                  >
                    <div className="flex flex-col gap-1">
                      {coverage.conflicts.map((conflict) => (
                        <p key={conflict} className="text-[11px] text-warning">
                          {conflict}
                        </p>
                      ))}
                    </div>
                  </CollapsibleSection>
                ) : null}
              </div>
              {/* Glass veil for stale figures — signals "being refreshed"
                  without dimming AA-calibrated text underneath. */}
              {updating ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-md bg-background/50 backdrop-blur-[1px] animate-fade-in"
                />
              ) : null}
            </div>
            {updating ? (
              <p className="text-xs text-muted-foreground animate-fade-in">
                Updating with your latest documents…
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RequirementAside({
  summary,
  coverageProgress,
  onToggleDismiss,
  togglePending,
  toggleError,
  onActivate,
  activating,
  activateError,
  hasDocumentsProcessing,
}: {
  summary: ComplianceSummaryPayload;
  coverageProgress: CoverageProgress;
  onToggleDismiss: (category: string, dismissed: boolean) => void;
  togglePending: boolean;
  toggleError: string | null;
  onActivate: () => void;
  activating: boolean;
  activateError: string | null;
  hasDocumentsProcessing: boolean;
}) {
  const remaining = summary.gate.blocking.length + summary.gate.missingMandatory.filter(
    (c) => !summary.gate.blocking.includes(c),
  ).length;
  const activated = ["PRE_APPROVED", "NEED_REVIEW", "APPROVED"].includes(
    summary.vendor.complianceStatus,
  );
  const rejected = summary.vendor.complianceStatus === "REJECTED";
  const manualDismissalsUsed = summary.categories.filter(
    (c) => c.dismissed && !c.autoDismissed,
  ).length;
  const dismissalCap = summary.profile.maxManualDismissable;
  const atDismissalCap = manualDismissalsUsed >= dismissalCap;

  // Gate-progress meter: satisfied = granted or dismissed (neither blocks).
  const totalCategories = summary.categories.length;
  const satisfiedCategories = summary.categories.filter(
    (c) => c.granted || c.state === "DISMISSED",
  ).length;
  const gatePct =
    totalCategories > 0 ? Math.round((satisfiedCategories / totalCategories) * 100) : 0;

  // One dynamic line covering every disabled cause, in gate order.
  const disabledReason =
    activated || rejected || activating
      ? null
      : hasDocumentsProcessing
        ? "Waiting for documents to finish processing…"
        : summary.coverage.determining
          ? "Waiting for the coverage review to finish…"
          : !summary.gate.cleared
            ? "Upload documents covering the remaining requirements to activate."
            : null;

  return (
    <aside className="grid w-full grid-cols-1 gap-3 md:grid-cols-2 md:items-start lg:flex lg:max-w-sm lg:flex-col xl:max-w-md">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Compliance requirements</CardTitle>
          <p className="text-xs text-muted-foreground">
            Profile: {summary.profile.name} — upload whatever you have; the system decides which
            requirements each document satisfies. Live alone on general liability? An umbrella policy can stack
            on top of a lower-limit policy to meet the requirement.
          </p>
          {/* Slim gate meter — the visual reason the activate CTA is gated. */}
          <div className="mt-1 flex items-center gap-2">
            <div aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-[width] duration-500"
                style={{ width: `${gatePct}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {satisfiedCategories} of {totalCategories} met
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {summary.categories.map((category) => (
              <CategoryRow
                key={category.category}
                category={category}
                onToggleDismiss={onToggleDismiss}
                togglePending={togglePending}
                atCap={atDismissalCap}
              />
            ))}
          </ul>
          {dismissalCap > 0 ? (
            <p className="mt-2 border-t border-border/60 pt-2 text-[11px] tabular-nums text-muted-foreground">
              {manualDismissalsUsed} of {dismissalCap}{" "}
              &ldquo;not applicable&rdquo; dismissals used
              {atDismissalCap ? " — un-dismiss one to free a slot." : "."}
            </p>
          ) : null}
          {toggleError ? (
            <p role="alert" className="mt-2 text-xs text-destructive animate-fade-in">
              {toggleError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <CoverageReadout coverage={summary.coverage} progress={coverageProgress} />

      <Card className="md:col-span-2 lg:col-span-1">
        <CardContent className="flex flex-col gap-2 p-4">
          {rejected ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 animate-fade-in">
              <p className="text-sm font-medium text-destructive">
                Your account was rejected
              </p>
              <p className="text-xs text-muted-foreground">
                Contact the compliance team to proceed — activation is disabled.
              </p>
            </div>
          ) : activated ? (
            <div className="rounded-md border border-primary/30 bg-primary/10 p-3 animate-fade-in">
              <p className="text-sm font-medium text-primary">
                Your onboarding is being reviewed
              </p>
              <p className="text-xs text-muted-foreground">
                A compliance officer will finalize your activation.
              </p>
            </div>
          ) : (
            <>
              <Button
                onClick={onActivate}
                disabled={
                  activating || hasDocumentsProcessing || summary.coverage.determining || !summary.gate.cleared
                }
                className={cn(
                  // Long computed labels wrap instead of overflowing <360px.
                  "h-auto min-h-9 whitespace-normal tabular-nums",
                  summary.gate.cleared &&
                    "bg-gradient-to-r from-primary to-primary/80 shadow-glow",
                )}
              >
                {activating
                  ? "Submitting…"
                  : summary.gate.cleared
                    ? "Activate vendor account"
                    : `${remaining} requirement ${remaining === 1 ? "category" : "categories"} remaining`}
              </Button>
              {activateError ? (
                <p role="alert" className="text-xs text-destructive animate-fade-in">
                  {activateError}
                </p>
              ) : null}
              {disabledReason ? (
                <p className="text-xs text-muted-foreground">{disabledReason}</p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}
