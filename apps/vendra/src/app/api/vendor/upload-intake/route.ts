/**
 * POST /api/vendor/upload-intake — synchronous presigned-PUT intake
 * (SPEC §6.4): INSERTs a PENDING document row per file under key
 * `vendor/{orgUuid}/{vendorUuid}/{batchId}/{fileId}`, merges the declared
 * file facts into file_metadata, then presigns a PUT per file. Processing
 * does NOT start here — the client PUTs bytes directly to storage, then
 * kicks /process. A presign failure flips that row FAILED and is contained
 * to the file.
 */
import { z } from "zod";

import type { UploadIntakeResponse } from "@/features/vendor-compliance/lib/vendor-harness-contract";
import {
  EXTENSION_BY_MIME,
  MAX_FILES,
  MAX_UPLOAD_BYTES,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";
import { authFailureResponse, requireVendorContact } from "@/server/auth-guards";
import {
  failPendingUpload,
  insertPendingDocument,
  mergePendingFileFacts,
} from "@/server/harness/db/documents";
import { vendraError, vendraLog, vendraWarn } from "@/server/harness/log";
import { generateUploadUrl } from "@/server/storage";

export const runtime = "nodejs";

const bodySchema = z.object({
  files: z
    .array(
      z.object({
        pointer: z.string().min(1),
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
        // nonnegative, not positive: a 0-byte file must be a PER-FILE
        // rejection below (SPEC §17 C7) — a positive() here failed the whole
        // batch, sinking valid siblings with a raw schema-shape error.
        fileSizeBytes: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export async function POST(req: Request) {
  // Guard BEFORE parsing (spec §16 B9): validating first handed
  // unauthenticated callers a 400-vs-401 oracle over the body shape.
  const auth = await requireVendorContact();
  if (!auth.ok) {
    vendraWarn("intake.rejected", { reason: auth.failure.kind });
    return authFailureResponse(auth.failure);
  }
  const ctx = auth.ctx;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Expected { files: [{ pointer, fileName, mimeType, fileSizeBytes }] }" },
      { status: 400 },
    );
  }
  const { files } = parsed.data;

  if (files.length > MAX_FILES) {
    return Response.json(
      { error: `Demasiados archivos: ${files.length} — el límite es de ${MAX_FILES} por solicitud.` },
      { status: 400 },
    );
  }

  const batchId = crypto.randomUUID();
  const targets: UploadIntakeResponse["targets"] = [];
  const failed: UploadIntakeResponse["failed"] = [];

  for (const file of files) {
    // Own-property lookup: mimeType is client-controlled, and a plain index
    // would let "constructor"/"__proto__" walk the prototype chain.
    if (!Object.hasOwn(EXTENSION_BY_MIME, file.mimeType)) {
      vendraWarn("intake.file_rejected", {
        vendor: ctx.vendor.id,
        file: file.fileName,
        mime: file.mimeType,
        reason: "unsupported_mime",
      });
      failed.push({
        pointer: file.pointer,
        fileName: file.fileName,
        reason: `Tipo no admitido "${file.mimeType}" — suba un archivo PNG, JPEG, WebP o PDF.`,
      });
      continue;
    }
    if (file.fileSizeBytes > MAX_UPLOAD_BYTES) {
      vendraWarn("intake.file_rejected", {
        vendor: ctx.vendor.id,
        file: file.fileName,
        bytes: file.fileSizeBytes,
        reason: "over_size_limit",
      });
      failed.push({
        pointer: file.pointer,
        fileName: file.fileName,
        reason: `El archivo pesa ${file.fileSizeBytes} bytes — el límite es de 10 MB.`,
      });
      continue;
    }
    if (file.fileSizeBytes === 0) {
      vendraWarn("intake.file_rejected", {
        vendor: ctx.vendor.id,
        file: file.fileName,
        reason: "empty",
      });
      failed.push({
        pointer: file.pointer,
        fileName: file.fileName,
        reason: "El archivo está vacío — expórtelo de nuevo y vuelva a subirlo.",
      });
      continue;
    }

    const fileId = crypto.randomUUID();
    // Every segment is server-derived, but keep the traversal guard absolute.
    const fileKey = `vendor/${ctx.organization.uuid}/${ctx.vendor.uuid}/${batchId}/${fileId}`;
    if (fileKey.includes("..")) {
      failed.push({
        pointer: file.pointer,
        fileName: file.fileName,
        reason: "Clave de archivo no válida.",
      });
      continue;
    }

    const row = await insertPendingDocument({
      organizationId: ctx.organization.id,
      vendorId: ctx.vendor.id,
      fileKey,
      batchId,
      fileId,
    });
    await mergePendingFileFacts(row.uuid, {
      mediaType: file.mimeType,
      fileName: file.fileName,
      fileSizeBytes: file.fileSizeBytes,
    });

    // Contain a presign failure to THIS file instead of 500ing the batch.
    let uploadUrl: string;
    try {
      uploadUrl = await generateUploadUrl(fileKey);
    } catch (err) {
      vendraError("intake.presign_failed", {
        vendor: ctx.vendor.id,
        doc: row.uuid,
        file: file.fileName,
        error: err instanceof Error ? err.message : String(err),
      });
      await failPendingUpload(
        row.uuid,
        "No se pudo preparar la carga. Intente de nuevo.",
      ).catch(() => undefined);
      failed.push({
        pointer: file.pointer,
        fileName: file.fileName,
        reason: "No se pudo preparar la carga. Intente de nuevo.",
      });
      continue;
    }
    targets.push({
      pointer: file.pointer,
      documentUuid: row.uuid,
      fileId,
      fileKey,
      uploadUrl,
    });
  }

  vendraLog("intake.batch", {
    vendor: ctx.vendor.id,
    org: ctx.organization.id,
    batch: batchId,
    files: files.length,
    accepted: targets.length,
    rejected: failed.length,
  });

  const response: UploadIntakeResponse = { batchId, targets, failed };
  return Response.json(response);
}
