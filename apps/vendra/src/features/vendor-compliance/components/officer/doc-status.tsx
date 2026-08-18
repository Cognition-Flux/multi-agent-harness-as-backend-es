/**
 * The officer document pill (SPEC §8.2) — ONE derivation shared by the
 * detail page's rows and the document viewer, evaluated top-down so the
 * strongest signal wins (an expired doc reads "Expired" even if waived).
 */
import { Badge } from "@/components/ui/primitives";

import type { ExistingVendorDocProjection } from "../../lib/vendor-harness-contract";

export type VendorDocumentPill =
  | "uploaded"
  | "expired"
  | "waived"
  | "queued"
  | "scope_accepted"
  | "failed"
  | "processing"
  | "verified";

export function deriveVendorDocumentStatus(
  doc: ExistingVendorDocProjection,
  now: Date,
): VendorDocumentPill {
  // 1. non-pipeline source — dormant in v1 (single upload surface).
  // 2. expired-by-extracted-date (UTC-midnight comparison).
  if (
    doc.extractedExpirationDate &&
    new Date(`${doc.extractedExpirationDate.slice(0, 10)}T00:00:00Z`).getTime() <=
      now.getTime()
  ) {
    return "expired";
  }
  // 3. active waiver.
  if (doc.waiverActive) return "waived";
  // 4. queued states.
  if (["PENDING", "UPLOADING", "UPLOADED"].includes(doc.uploadStatus)) return "queued";
  // 5. FAILED + scoped categories → "Counted · coverage".
  if (
    (doc.uploadStatus === "FAILED" || doc.uploadStatus === "ERROR") &&
    (doc.scopedCategories?.length ?? 0) > 0
  ) {
    return "scope_accepted";
  }
  // 6. FAILED.
  if (doc.uploadStatus === "FAILED" || doc.uploadStatus === "ERROR") return "failed";
  // 7. non-PROCESSED.
  if (doc.uploadStatus !== "PROCESSED") return "processing";
  // 8. granted → verified, else failed.
  return (doc.extraction?.requirementsGranted.length ?? 0) > 0 ||
    (doc.manualGrants?.length ?? 0) > 0
    ? "verified"
    : "failed";
}

export function DocPill({ pill }: { pill: VendorDocumentPill }) {
  switch (pill) {
    case "expired":
      return <Badge variant="warning">Vencido</Badge>;
    case "waived":
      return <Badge variant="success">Eximido</Badge>;
    case "queued":
      return <Badge variant="muted">En cola</Badge>;
    case "scope_accepted":
      return <Badge variant="warning">Contado · cobertura</Badge>;
    case "failed":
      return <Badge variant="destructive">Fallido</Badge>;
    case "processing":
      return <Badge variant="agent">Procesando</Badge>;
    case "verified":
      return <Badge variant="success">Verificado</Badge>;
    default:
      return <Badge variant="muted">Subido</Badge>;
  }
}
