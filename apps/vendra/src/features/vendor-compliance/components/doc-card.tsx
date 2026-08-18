"use client";

/**
 * One document card (SPEC §7.2): classification, the extraction table
 * (masked TIN — masking happened at persist time), the per-rule validation
 * checklist (informational rules render as warnings, never blockers),
 * granted-category chips, the coverage-scoped "Counted · coverage" state,
 * the live agent activity feed, and the HITL prompt.
 */
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Badge, Button, Loader, Shimmer } from "@/components/ui/primitives";
import { cn, formatDate } from "@/lib/utils";

import {
  requirementCategoryLabel,
  vendorDocumentTypeTitle,
  type ValidationRule,
} from "@vendra/workflow/vendor";

import type { ClientDoc } from "../hooks/use-documents-controller";
import {
  STAGE_INDEX,
  STAGE_MESSAGES,
  TOTAL_STAGES,
  type ProcessingStage,
} from "../lib/vendor-harness-contract";
import { CollapsibleSection } from "./collapsible-section";
import { HitlPrompt } from "./hitl-prompt";

function StatusPill({ doc }: { doc: ClientDoc }) {
  const server = doc.server;
  const live = doc.liveVM;
  if (doc.status === "QUEUED") return <Badge variant="muted">Queued</Badge>;
  if (doc.status === "UPLOADING") return <Badge variant="muted">Uploading…</Badge>;
  if (doc.status === "UPLOAD_FAILED")
    return <Badge variant="destructive">Upload failed</Badge>;
  if (doc.status === "UPLOADED") return <Badge variant="muted">Uploaded</Badge>;
  if (doc.status === "PROCESSING") {
    if (live?.status === "PROCESSED") return <Badge variant="success">Verified</Badge>;
    if (live?.status === "FAILED") {
      return (live.terminal?.scopedCategories?.length ?? 0) > 0 ? (
        <Badge variant="warning">Counted · coverage</Badge>
      ) : (
        <Badge variant="destructive">Failed</Badge>
      );
    }
    if (live?.status === "ERROR") return <Badge variant="destructive">Interrupted</Badge>;
    return (
      <Badge variant="agent">
        <Loader className="h-3 w-3 text-agent" /> Processing
      </Badge>
    );
  }
  // SETTLED — the server projection when reconciled; else the live verdict
  // (a just-settled stream's terminal, until the next snapshot refresh).
  if (!server && live?.terminal) {
    if (live.terminal.status === "COMPLETED") {
      return <Badge variant="success">Verified</Badge>;
    }
    return (live.terminal.scopedCategories?.length ?? 0) > 0 ? (
      <Badge variant="warning">Counted · coverage</Badge>
    ) : (
      <Badge variant="destructive">Failed</Badge>
    );
  }
  switch (server?.uploadStatus) {
    case "PROCESSED":
      return <Badge variant="success">Verified</Badge>;
    case "FAILED":
    case "ERROR":
      return (server.scopedCategories?.length ?? 0) > 0 ? (
        <Badge variant="warning">Counted · coverage</Badge>
      ) : (
        <Badge variant="destructive">Failed</Badge>
      );
    case "PROCESSING":
    case "UPLOADED":
    case "PENDING":
      return (
        <Badge variant="secondary">
          <Loader className="h-3 w-3" /> Processing
        </Badge>
      );
    default:
      return <Badge variant="muted">Uploaded</Badge>;
  }
}

/**
 * Coarse visual tone for the whole card, mirroring the StatusPill verdict:
 * "live" while the agent streams (agent-accent ring), "verified"/"failed" tints on
 * settle, "neutral" for everything else (incl. "Counted · coverage", which
 * keeps its warning pill without a destructive card wash).
 */
function cardTone(doc: ClientDoc): "live" | "verified" | "failed" | "neutral" {
  const live = doc.liveVM;
  const server = doc.server;
  if (doc.status === "UPLOAD_FAILED") return "failed";
  if (doc.status === "PROCESSING") {
    if (live?.status === "PROCESSED") return "verified";
    if (live?.status === "ERROR") return "failed";
    if (live?.status === "FAILED") {
      return (live.terminal?.scopedCategories?.length ?? 0) > 0 ? "neutral" : "failed";
    }
    return "live";
  }
  if (!server && live?.terminal) {
    if (live.terminal.status === "COMPLETED") return "verified";
    return (live.terminal.scopedCategories?.length ?? 0) > 0 ? "neutral" : "failed";
  }
  switch (server?.uploadStatus) {
    case "PROCESSED":
      return "verified";
    case "FAILED":
    case "ERROR":
      return (server.scopedCategories?.length ?? 0) > 0 ? "neutral" : "failed";
    default:
      return "neutral";
  }
}

const STAGE_ORDER = Object.keys(STAGE_INDEX) as ProcessingStage[];

/**
 * The pipeline-stage checklist as an AI Elements `<Task>` — a progress bar
 * headline plus a collapsible per-stage item list (done / active / pending).
 */
function StageProgress({ stage }: { stage: ProcessingStage }) {
  const index = STAGE_INDEX[stage];
  return (
    <div className="flex flex-col gap-1.5" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-agent transition-[width] duration-500 ease-out"
            style={{ width: `${Math.round((index / TOTAL_STAGES) * 100)}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          Stage {index} of {TOTAL_STAGES}
        </span>
      </div>
      <Task defaultOpen={false}>
        <TaskTrigger title={STAGE_MESSAGES[stage]} />
        <TaskContent>
          {STAGE_ORDER.map((s) => (
            <TaskItem
              key={s}
              state={
                STAGE_INDEX[s] < index ? "done" : STAGE_INDEX[s] === index ? "active" : "pending"
              }
            >
              {STAGE_MESSAGES[s]}
            </TaskItem>
          ))}
        </TaskContent>
      </Task>
    </div>
  );
}

const EXTRACTION_PREVIEW_ROWS = 14;

function ExtractionTable({ data }: { data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== "");
  if (entries.length === 0) return null;
  const visible = expanded ? entries : entries.slice(0, EXTRACTION_PREVIEW_ROWS);
  const hidden = entries.length - visible.length;
  return (
    <div className="animate-fade-in-up overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <tbody>
          {visible.map(([key, value]) => (
            <tr key={key} className="border-b odd:bg-muted/30 last:border-b-0">
              <td className="px-2 py-1 font-medium text-muted-foreground sm:whitespace-nowrap">
                {key.replaceAll("_", " ")}
              </td>
              <td className="px-2 py-1">
                {key.endsWith("_last4")
                  ? `••-•••${String(value)}`
                  : typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 || expanded ? (
        <button
          type="button"
          className="w-full border-t px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `+${hidden} more field${hidden === 1 ? "" : "s"}`}
        </button>
      ) : null}
    </div>
  );
}

/** At-a-glance digest for the collapsed trigger — zero-count parts omitted. */
function validationSummary(rules: ValidationRule[]): string {
  const passed = rules.filter((r) => !r.informational && r.passed).length;
  const failed = rules.filter((r) => !r.informational && !r.passed).length;
  const informational = rules.filter((r) => r.informational).length;
  const parts = [`${passed} passed`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (informational > 0) parts.push(`${informational} informational`);
  return parts.join(" · ");
}

function ValidationChecklist({ rules }: { rules: ValidationRule[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {rules.map((rule) => (
        <li key={rule.rule} className="flex items-start gap-1.5 text-xs">
          {rule.informational ? (
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          ) : rule.passed ? (
            <CheckCircle2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          ) : (
            <XCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          )}
          <span
            className={cn(
              rule.informational
                ? "text-muted-foreground"
                : rule.passed
                  ? "text-foreground"
                  : "text-destructive",
            )}
          >
            {rule.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DocCard({
  doc,
  onTryAgain,
  onRetryUpload,
  onDelete,
  verbose,
}: {
  doc: ClientDoc;
  onTryAgain: (pointer: string) => void;
  onRetryUpload: (pointer: string) => void;
  onDelete: (pointer: string) => void;
  verbose: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const live = doc.liveVM;
  const server = doc.server;
  // The live fold stays the render source after settle until the durable
  // projection has caught up to a terminal status (SPEC §17 C2) — otherwise
  // a just-settled card would show a stale pre-terminal server row.
  const serverSettled =
    !!server && ["PROCESSED", "FAILED", "ERROR"].includes(server.uploadStatus);
  const isLive =
    doc.status === "PROCESSING" ||
    (!!live && (!!live.terminal || live.status === "ERROR") && !serverSettled);

  // A stale two-step confirm must never survive a status change (e.g. a
  // retry or snapshot reconcile) — it would confirm against different facts.
  useEffect(() => {
    setConfirmDelete(false);
  }, [doc.status, doc.documentUuid]);

  const documentType = isLive
    ? (live?.terminal?.documentType ?? undefined)
    : server?.extraction?.documentType;
  const extraction = isLive
    ? live?.extraction?.extractedData
    : server?.extraction?.extractedData;
  const rules = isLive
    ? live?.validation?.rules
    : (server?.extraction?.validationRules ?? undefined);
  const granted = isLive
    ? (live?.terminal?.requirementsGranted ?? [])
    : (server?.extraction?.requirementsGranted ?? []);
  const scoped = isLive
    ? (live?.terminal?.scopedCategories ?? [])
    : (server?.scopedCategories ?? []);
  const failureReason = isLive
    ? (live?.terminal?.reason ?? live?.errorText)
    : server?.failureReason;
  const settledFailed =
    (isLive && (live?.status === "FAILED" || live?.status === "ERROR")) ||
    (!isLive && (server?.uploadStatus === "FAILED" || server?.uploadStatus === "ERROR"));
  const grantsCategories = granted.length > 0 || (doc.server?.manualGrants?.length ?? 0) > 0;
  const tone = cardTone(doc);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-soft transition-colors duration-300 sm:p-4",
        tone === "live" && "animate-glow-pulse ring-1 ring-inset ring-agent/20",
        tone === "verified" && "bg-success/5",
        tone === "failed" && "bg-destructive/5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{doc.fileName}</p>
          {documentType ? (
            <p className="text-xs text-muted-foreground">
              {vendorDocumentTypeTitle(documentType)}
            </p>
          ) : null}
          {!isLive && server?.extractedExpirationDate ? (
            <p className="text-xs text-muted-foreground">
              Expires {formatDate(server.extractedExpirationDate)}
            </p>
          ) : null}
        </div>
        <div className="shrink-0">
          <StatusPill doc={doc} />
        </div>
      </div>

      {doc.status === "UPLOAD_FAILED" && doc.uploadError ? (
        <p className="text-xs text-destructive">{doc.uploadError}</p>
      ) : null}

      {isLive && live && !live.terminal ? (
        <div className="flex animate-fade-in-up flex-col gap-2 rounded-md border border-agent/10 bg-card/60 p-2.5 backdrop-blur-sm sm:p-3">
          {live.stage ? <StageProgress stage={live.stage} /> : <Shimmer className="h-4 w-2/3" />}
          {live.narration ? (
            <p className="text-xs italic text-muted-foreground" aria-live="polite">
              “{live.narration}”
            </p>
          ) : null}
          {verbose && live.reasoningText ? (
            <Reasoning reasoning={live.reasoningText} isStreaming={!live.terminal}>
              <ReasoningTrigger />
              <ReasoningContent />
            </Reasoning>
          ) : null}
          {verbose && live.toolActivity.length > 0 ? (
            <div className="flex flex-col gap-1">
              {/* Tool-part state machine, keyed by toolCallId — never array index. */}
              {live.toolActivity.map((tool) => (
                <Tool key={tool.toolCallId}>
                  <ToolHeader type={tool.name} state={tool.state} />
                  <ToolContent>
                    <ToolInput input={tool.input} />
                    {tool.state === "output-error" ? (
                      <ToolOutput errorText={tool.errorText ?? "The tool call failed."} />
                    ) : null}
                    {tool.state === "input-streaming" ? (
                      <Shimmer className="h-3 w-1/2" />
                    ) : null}
                  </ToolContent>
                </Tool>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {isLive && live?.confirmation && doc.documentUuid ? (
        <div className="animate-fade-in-up">
          <HitlPrompt documentUuid={doc.documentUuid} confirmation={live.confirmation} />
        </div>
      ) : null}

      {settledFailed && failureReason ? (
        <p className="text-xs text-destructive">{failureReason}</p>
      ) : null}

      {scoped.length > 0 ? (
        <p className="text-xs text-warning">
          Still counts toward: {scoped.map((c) => requirementCategoryLabel(c)).join(", ")} — the
          coverage review decides the final limits.
        </p>
      ) : null}

      {granted.length > 0 ? (
        <div className="flex animate-fade-in-up flex-wrap gap-1">
          {granted.map((category) => (
            <Badge key={category} variant="success" className="text-[11px]">
              {requirementCategoryLabel(category)}
            </Badge>
          ))}
        </div>
      ) : null}

      {doc.server?.manualGrants?.length ? (
        <div className="flex animate-fade-in-up flex-wrap gap-1">
          {doc.server.manualGrants.map((grant) => (
            <Badge key={grant.category} variant="success" className="text-[11px]">
              {requirementCategoryLabel(grant.category)} (manually granted)
            </Badge>
          ))}
        </div>
      ) : null}

      {doc.server?.waiverActive ? (
        <Badge variant="success" className="w-fit animate-fade-in-up text-[11px]">
          Waived by your compliance officer
          {doc.server.waiverExpiresAt ? ` until ${formatDate(doc.server.waiverExpiresAt)}` : ""}
        </Badge>
      ) : null}

      {doc.server?.additionalEntityNames?.length ? (
        <p className="text-xs text-warning">
          This file also contains documents for: {doc.server.additionalEntityNames.join(", ")} —
          upload each business's documents separately.
        </p>
      ) : null}

      {/* Long-form agent output is collapsed-by-default (SPEC §17 C8) — the
          trigger summaries keep the card informative without the wall of
          text; each section opens independently. */}
      {!isLive && server?.extraction?.classificationReasoning ? (
        <CollapsibleSection label="Why this classification">
          <p className="text-muted-foreground">
            {server.extraction.classificationReasoning}
          </p>
        </CollapsibleSection>
      ) : null}
      {extraction && (settledFailed || granted.length > 0 || !isLive) ? (
        <CollapsibleSection
          label="Extracted fields"
          summary={`${
            Object.values(extraction).filter((v) => v !== null && v !== "").length
          } fields`}
        >
          <ExtractionTable data={extraction} />
        </CollapsibleSection>
      ) : null}
      {rules && rules.length > 0 ? (
        <CollapsibleSection
          label="Validation results"
          summary={validationSummary(rules)}
        >
          <ValidationChecklist rules={rules} />
        </CollapsibleSection>
      ) : null}

      {doc.actionError ? (
        <p role="alert" className="text-xs text-destructive">
          {doc.actionError}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        {doc.status === "UPLOAD_FAILED" ? (
          <Button size="sm" variant="outline" onClick={() => onRetryUpload(doc.pointer)}>
            Try again
          </Button>
        ) : settledFailed && doc.documentUuid ? (
          <Button size="sm" variant="outline" onClick={() => onTryAgain(doc.pointer)}>
            Try again
          </Button>
        ) : null}
        {doc.status === "SETTLED" || settledFailed || doc.status === "UPLOAD_FAILED" ? (
          confirmDelete && grantsCategories ? (
            <span className="flex flex-wrap items-center gap-1 text-xs">
              Removes {granted.length > 0 ? granted.map((c) => requirementCategoryLabel(c)).join(", ") : "its evidence"} —
              <Button size="sm" variant="destructive" onClick={() => void onDelete(doc.pointer)}>
                Delete anyway
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                if (grantsCategories) setConfirmDelete(true);
                else void onDelete(doc.pointer);
              }}
            >
              Delete
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
