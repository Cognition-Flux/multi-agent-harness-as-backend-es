"use client";

/**
 * The officer rescue-toolkit dialogs (SPEC §8.3): waive (B-1 cascade is
 * server-enforced — the dialog only proposes), reclassify, manual grant
 * (with the failed-doc acknowledgement), revoke. Every dialog enforces the
 * justification length client-side for fast feedback; the server re-checks.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button, Dialog, Input, Label, Loader, Textarea } from "@/components/ui/primitives";
import { useTRPC } from "@/lib/trpc-client";

import {
  REQUIREMENT_CATEGORY_VALUES,
  VENDOR_DOCUMENT_TYPE_VALUES,
  getPotentialRequirementsForDocumentType,
  requirementCategoryLabel,
  vendorDocumentTypeTitle,
  type RequirementCategoryType,
  type VendorDocumentType,
} from "@vendra/workflow/vendor";

import type { ExistingVendorDocProjection } from "../../lib/vendor-harness-contract";

/**
 * Scoped invalidation for officer mutations: only the vendor-data procedures
 * refetch (all inputs), instead of blowing away the whole query cache —
 * download-URL queries and unrelated vendors' data stay warm.
 */
export function useInvalidateVendorData() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries(trpc.getVendor.pathFilter());
    void queryClient.invalidateQueries(trpc.requirementTraceability.pathFilter());
    void queryClient.invalidateQueries(trpc.listVendors.pathFilter());
  };
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof Error ? error.message : "The action failed — try again.";
  return (
    <p
      role="alert"
      className="animate-fade-in rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
    >
      {message}
    </p>
  );
}

/** Native-select styling matched to the Input primitive (one control vocabulary). */
const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-sm transition-[border-color,box-shadow] focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50";

/** Why-is-the-button-disabled hint under a justification textarea. */
function JustificationHint({ value }: { value: string }) {
  const length = value.trim().length;
  const remaining = 10 - length;
  if (remaining <= 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1 w-full overflow-hidden rounded-full bg-primary/10">
        <div
          className="h-full rounded-full bg-primary/40 transition-[width] duration-300"
          style={{ width: `${Math.min(100, (length / 10) * 100)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="tabular-nums">{remaining}</span> more character
        {remaining === 1 ? "" : "s"} needed — the justification lands in the audit trail.
      </p>
    </div>
  );
}

// ── Waive ────────────────────────────────────────────────────────────────────

export function WaiveDialog({
  doc,
  open,
  onClose,
}: {
  doc: ExistingVendorDocProjection;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidateVendorData();
  const potential = doc.extraction
    ? getPotentialRequirementsForDocumentType(
        doc.extraction.documentType as VendorDocumentType,
      )
    : [];
  const [selected, setSelected] = useState<RequirementCategoryType[]>([]);
  const [justification, setJustification] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const mutation = useMutation(
    trpc.waiveDocumentValidation.mutationOptions({
      onSuccess: () => {
        invalidate();
        onClose();
      },
    }),
  );
  const waiverActive = doc.waiverActive === true;

  // A reopened dialog must never show last time's inputs or error.
  const { reset } = mutation;
  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setJustification("");
    setExpiresAt(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    reset();
  }, [open, reset]);

  return (
    <Dialog open={open} onClose={onClose} title={waiverActive ? "Remove waiver" : "Waive validation"}>
      <div className="flex flex-col gap-3">
        {!waiverActive ? (
          <>
            <p className="rounded-md bg-muted/50 p-2.5 text-sm text-muted-foreground">
              Grant ONLY the categories this failure legitimately blocks — the server narrows the
              scope again (a name mismatch can never waive into tax identity).
            </p>
            <div className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2.5">
              {potential.map((category) => (
                <label key={category} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input accent-primary"
                    checked={selected.includes(category)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked
                          ? [...prev, category]
                          : prev.filter((c) => c !== category),
                      )
                    }
                  />
                  {requirementCategoryLabel(category)}
                </label>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="waive-expiry">Waiver expires</Label>
              <Input
                id="waive-expiry"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </>
        ) : (
          <p className="rounded-md bg-muted/50 p-2.5 text-sm text-muted-foreground">
            Removing the waiver clears every category it granted.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="waive-justification">Justification (10–1000 chars)</Label>
          <Textarea
            id="waive-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Why is this acceptable? This lands in the audit trail."
          />
          <JustificationHint value={justification} />
        </div>
        <ErrorLine error={mutation.error} />
        <Button
          disabled={
            mutation.isPending ||
            justification.trim().length < 10 ||
            (!waiverActive && (selected.length === 0 || !expiresAt))
          }
          onClick={() =>
            mutation.mutate({
              vendorDocumentUuid: doc.documentUuid,
              waive: !waiverActive,
              scopedCategories: selected,
              justification: justification.trim(),
              ...(waiverActive ? {} : { waiverExpiresAt: new Date(`${expiresAt}T00:00:00Z`) }),
              expectedCurrentWaiver: waiverActive,
            })
          }
        >
          {mutation.isPending ? <Loader className="h-3.5 w-3.5 text-current" /> : null}
          {mutation.isPending ? "Applying…" : waiverActive ? "Remove waiver" : "Apply waiver"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Reclassify ───────────────────────────────────────────────────────────────

export function ReclassifyDialog({
  doc,
  open,
  onClose,
}: {
  doc: ExistingVendorDocProjection;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidateVendorData();
  const [target, setTarget] = useState("");
  const [justification, setJustification] = useState("");
  const mutation = useMutation(
    trpc.reclassifyDocument.mutationOptions({
      onSuccess: () => {
        invalidate();
        onClose();
      },
    }),
  );

  // A reopened dialog must never show last time's inputs or error.
  const { reset } = mutation;
  useEffect(() => {
    if (!open) return;
    setTarget("");
    setJustification("");
    reset();
  }, [open, reset]);

  return (
    <Dialog open={open} onClose={onClose} title="Re-categorize document">
      <div className="flex flex-col gap-3">
        <p className="rounded-md bg-muted/50 p-2.5 text-sm text-muted-foreground">
          Re-runs validation and requirement mapping on the carried-forward extraction under the
          new type; inserts a fresh extraction version (waiver state resets).
        </p>
        <select
          aria-label="New document type"
          className={SELECT_CLASS}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">Choose a type…</option>
          {VENDOR_DOCUMENT_TYPE_VALUES.filter((t) => t !== "UNKNOWN").map((type) => (
            <option key={type} value={type}>
              {vendorDocumentTypeTitle(type)}
            </option>
          ))}
        </select>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reclass-justification">Justification (10–500 chars)</Label>
          <Textarea
            id="reclass-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
          <JustificationHint value={justification} />
        </div>
        <ErrorLine error={mutation.error} />
        <Button
          disabled={mutation.isPending || !target || justification.trim().length < 10}
          onClick={() =>
            mutation.mutate({
              vendorDocumentUuid: doc.documentUuid,
              newDocumentType: target as VendorDocumentType,
              justification: justification.trim(),
            })
          }
        >
          {mutation.isPending ? <Loader className="h-3.5 w-3.5 text-current" /> : null}
          {mutation.isPending ? "Reclassifying…" : "Reclassify"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Grant / revoke ───────────────────────────────────────────────────────────

export function GrantDialog({
  doc,
  open,
  onClose,
}: {
  doc: ExistingVendorDocProjection;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidateVendorData();
  const [category, setCategory] = useState("");
  const [justification, setJustification] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const isFailed = doc.uploadStatus === "FAILED" || doc.uploadStatus === "ERROR";
  const mutation = useMutation(
    trpc.grantManualRequirement.mutationOptions({
      onSuccess: () => {
        invalidate();
        onClose();
      },
    }),
  );

  // A reopened dialog must never show last time's inputs or error.
  const { reset } = mutation;
  useEffect(() => {
    if (!open) return;
    setCategory("");
    setJustification("");
    setAcknowledged(false);
    reset();
  }, [open, reset]);

  return (
    <Dialog open={open} onClose={onClose} title="Grant requirement manually">
      <div className="flex flex-col gap-3">
        <p className="rounded-md bg-muted/50 p-2.5 text-sm text-muted-foreground">
          For evidence you verified out-of-band (e.g. you called the carrier). Scoped per
          category — the "(manually granted)" label is per row, never per document.
        </p>
        <select
          aria-label="Category"
          className={SELECT_CLASS}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Choose a category…</option>
          {REQUIREMENT_CATEGORY_VALUES.map((c) => (
            <option key={c} value={c}>
              {requirementCategoryLabel(c)}
            </option>
          ))}
        </select>
        {isFailed ? (
          <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-warning"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>
              I acknowledge this document FAILED validation and I am granting against it anyway.
            </span>
          </label>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grant-justification">Justification (10–1000 chars)</Label>
          <Textarea
            id="grant-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
          <JustificationHint value={justification} />
        </div>
        <ErrorLine error={mutation.error} />
        <Button
          disabled={
            mutation.isPending ||
            !category ||
            justification.trim().length < 10 ||
            (isFailed && !acknowledged)
          }
          onClick={() =>
            mutation.mutate({
              vendorDocumentUuid: doc.documentUuid,
              category: category as RequirementCategoryType,
              justification: justification.trim(),
              acknowledgeOverride: acknowledged,
            })
          }
        >
          {mutation.isPending ? <Loader className="h-3.5 w-3.5 text-current" /> : null}
          {mutation.isPending ? "Granting…" : "Grant"}
        </Button>
      </div>
    </Dialog>
  );
}

export function RevokeDialog({
  doc,
  category,
  open,
  onClose,
}: {
  doc: ExistingVendorDocProjection;
  category: string;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidateVendorData();
  const [justification, setJustification] = useState("");
  const mutation = useMutation(
    trpc.revokeManualRequirement.mutationOptions({
      onSuccess: () => {
        invalidate();
        onClose();
      },
    }),
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Revoke ${requirementCategoryLabel(category)}`}
      className="border-destructive/30"
    >
      <div className="flex flex-col gap-3">
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          Revoking removes this manually granted category — coverage recomputes immediately.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="revoke-justification">Justification (10–1000 chars)</Label>
          <Textarea
            id="revoke-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
          <JustificationHint value={justification} />
        </div>
        <ErrorLine error={mutation.error} />
        <Button
          variant="destructive"
          disabled={mutation.isPending || justification.trim().length < 10}
          onClick={() =>
            mutation.mutate({
              vendorDocumentUuid: doc.documentUuid,
              category: category as RequirementCategoryType,
              justification: justification.trim(),
            })
          }
        >
          {mutation.isPending ? <Loader className="h-3.5 w-3.5 text-current" /> : null}
          {mutation.isPending ? "Revoking…" : "Revoke grant"}
        </Button>
      </div>
    </Dialog>
  );
}
