/**
 * Env-configured object storage (SPEC §6.12) — MinIO locally, real S3 in
 * cloud. TWO clients, one bucket:
 *
 * - `storageClient` — server-side ops (doc-run byte reads) against the
 *   in-network endpoint (http://minio:9000 in compose).
 * - `presignClient` — presigning against the BROWSER-reachable endpoint
 *   (http://localhost:9000 in compose). SigV4 signs the host, so presigning
 *   against the internal hostname would produce URLs the browser can't
 *   verify.
 *
 * `requestChecksumCalculation: "WHEN_REQUIRED"` on the presign client is
 * MANDATORY: AWS SDK ≥3.729's WHEN_SUPPORTED default bakes an empty-body
 * CRC32 checksum into presigned PUT URLs that browser uploads cannot satisfy.
 *
 * On AWS, unset S3_ENDPOINT_URL / S3_PUBLIC_ENDPOINT_URL and the SDK's
 * default resolution takes over — one code path, zero flags.
 */
import {
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "@/env";

const base = {
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
};

/** Server-side ops — the in-network endpoint. */
export const storageClient = new S3Client({
  ...base,
  ...(env.S3_ENDPOINT_URL ? { endpoint: env.S3_ENDPOINT_URL } : {}),
});

/** Presigning — the browser-reachable endpoint, checksum-free. */
export const presignClient = new S3Client({
  ...base,
  ...(env.S3_PUBLIC_ENDPOINT_URL || env.S3_ENDPOINT_URL
    ? { endpoint: env.S3_PUBLIC_ENDPOINT_URL ?? env.S3_ENDPOINT_URL }
    : {}),
  requestChecksumCalculation: "WHEN_REQUIRED",
});

/** Presigned PUT for the browser upload (900s expiry). */
export function generateUploadUrl(key: string): Promise<string> {
  return getSignedUrl(
    presignClient,
    new PutObjectCommand({ Bucket: env.VENDOR_DOCS_BUCKET, Key: key }),
    { expiresIn: 900 },
  );
}

/**
 * Presigned GET for the officer viewer's view/download invariant (§8.2).
 * `disposition` steers the browser: "inline" renders in the viewer pane
 * (img/iframe), "attachment" forces a save-as with the original filename.
 * Both are response-header overrides baked into the signature — the object
 * itself is untouched and the URL still expires in 900s.
 */
export function generateDownloadUrl(
  key: string,
  opts?: {
    disposition?: "inline" | "attachment";
    fileName?: string;
    mimeType?: string;
  },
): Promise<string> {
  const { disposition, fileName, mimeType } = opts ?? {};
  // Header-safe filename: non-ASCII/control chars, quotes, path separators,
  // and ".." components all neutralized — MinIO 400s a request whose
  // disposition param contains ".." (XMinioInvalidResourceName), and our own
  // bucket doesn't need the RFC 6266 filename* escape hatch.
  const safeName =
    fileName
      ?.replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\/]/g, "_")
      .replace(/\.{2,}/g, "_")
      .trim()
      .replace(/^\.+/, "") || undefined;
  return getSignedUrl(
    presignClient,
    new GetObjectCommand({
      Bucket: env.VENDOR_DOCS_BUCKET,
      Key: key,
      ...(disposition
        ? {
            ResponseContentDisposition: safeName
              ? `${disposition}; filename="${safeName}"`
              : disposition,
          }
        : {}),
      ...(mimeType ? { ResponseContentType: mimeType } : {}),
    }),
    { expiresIn: 900 },
  );
}

/**
 * Fetch a stored document's bytes — the fetch IS the claim-time byte
 * verification (§6.1.2): empty/missing throws.
 */
export async function readDocumentBytes(fileKey: string): Promise<Uint8Array> {
  const obj = await storageClient.send(
    new GetObjectCommand({ Bucket: env.VENDOR_DOCS_BUCKET, Key: fileKey }),
  );
  const body = await obj.Body?.transformToByteArray();
  if (!body || body.length === 0) {
    throw new Error(`Storage object empty or missing: ${fileKey}`);
  }
  return body;
}

/** Best-effort object delete (the document DELETE route). */
export async function deleteDocumentObject(fileKey: string): Promise<void> {
  await storageClient.send(
    new DeleteObjectCommand({ Bucket: env.VENDOR_DOCS_BUCKET, Key: fileKey }),
  );
}

/** Health probe: the bucket answers HEAD (never creates anything). */
export async function checkStorageHealth(): Promise<boolean> {
  try {
    await storageClient.send(
      new HeadBucketCommand({ Bucket: env.VENDOR_DOCS_BUCKET }),
    );
    return true;
  } catch {
    return false;
  }
}
