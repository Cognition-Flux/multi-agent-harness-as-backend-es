"use client";

/**
 * The single documents controller (SPEC §7.2) — one registry owning
 * every document's lifecycle: client-generated `pointer` ids for optimistic
 * rows, QUEUED → UPLOADING → (PUT to presigned URL) → UPLOADED → PROCESSING
 * → settled. Streaming concurrency is client-gated at
 * MAX_CONCURRENT_DOC_STREAMS = 3, aligned with the server's 3-slot
 * semaphore.
 *
 * Upload hardening: the controller pre-reads `file.arrayBuffer()`, verifies
 * byteLength === file.size, and PUTs the in-memory bytes (never the
 * lazily-streamed File) — a file changed on disk after selection fails the
 * card with the real cause.
 *
 * Snapshot poll: ~10s while any unstreamed server run exists — also the
 * officer→vendor propagation channel (waivers/reclassifies/retries arrive
 * within one cycle).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ExistingVendorDocProjection,
  UploadIntakeResponse,
} from "../lib/vendor-harness-contract";
import {
  ACCEPTED_MIME_TYPES,
  MAX_CONCURRENT_DOC_STREAMS,
  MAX_UPLOAD_BYTES,
} from "../lib/vendor-harness-contract";
import type { DocVM } from "../lib/doc-vm";

export type ClientDocStatus =
  | "QUEUED"
  | "UPLOADING"
  | "UPLOAD_FAILED"
  | "UPLOADED"
  | "PROCESSING"
  | "SETTLED";

export interface ClientDoc {
  pointer: string;
  fileName: string;
  fileSizeBytes: number;
  mediaType: string;
  status: ClientDocStatus;
  documentUuid?: string;
  uploadError?: string;
  /** A failed row action (e.g. delete rejected while processing). */
  actionError?: string;
  /** Increments on Try-again so useChat never resurfaces cached messages. */
  retryNonce: number;
  /** The durable server projection (reconciled from the snapshot poll). */
  server?: ExistingVendorDocProjection;
  /** The live stream's fold, pushed up by the DocumentProcessor. */
  liveVM?: DocVM;
}

const SNAPSHOT_POLL_MS = 10_000;

function makePointer(): string {
  return `doc-${crypto.randomUUID()}`;
}

export interface DocumentsControllerApi {
  docs: ClientDoc[];
  addFiles: (files: File[]) => Promise<void>;
  intakeErrors: { fileName: string; reason: string }[];
  clearIntakeErrors: () => void;
  onDocTerminal: (pointer: string) => void;
  onDocVM: (pointer: string, vm: DocVM) => void;
  tryAgain: (pointer: string) => void;
  retryUpload: (pointer: string) => void;
  deleteDoc: (pointer: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useDocumentsController(options: {
  initialDocuments: ExistingVendorDocProjection[];
  onSettled?: () => void;
}): DocumentsControllerApi {
  const { onSettled } = options;
  const [docs, setDocs] = useState<ClientDoc[]>(() =>
    options.initialDocuments.map((server) => ({
      pointer: makePointer(),
      fileName: server.fileName,
      fileSizeBytes: server.fileSizeBytes ?? 0,
      mediaType: "",
      status: serverStatusToClient(server.uploadStatus),
      documentUuid: server.documentUuid,
      retryNonce: 0,
      server,
    })),
  );
  const [intakeErrors, setIntakeErrors] = useState<
    { fileName: string; reason: string }[]
  >([]);
  const bytesByPointer = useRef(new Map<string, ArrayBuffer>());
  // Staged File handles kept per pointer so a failed upload can be retried
  // without re-selecting (cleared once the PUT lands or the row is removed).
  const filesByPointer = useRef(new Map<string, File>());
  const docsRef = useRef(docs);
  docsRef.current = docs;

  const update = useCallback(
    (pointer: string, patch: Partial<ClientDoc>) => {
      setDocs((prev) =>
        prev.map((d) => (d.pointer === pointer ? { ...d, ...patch } : d)),
      );
    },
    [],
  );

  /** Flip at most MAX_CONCURRENT_DOC_STREAMS docs to PROCESSING. */
  const promoteQueued = useCallback(() => {
    setDocs((prev) => {
      // An errored client stream may still shadow a DETACHED server run
      // holding its semaphore slot (the process route deliberately ignores
      // req.signal — R5): only a settled server row proves the slot is
      // actually free. Pre-claim failures keep counting, so a systemic
      // outage never cascades the whole queue into failed streams.
      const live = prev.filter(
        (d) =>
          d.status === "PROCESSING" &&
          !(d.liveVM?.status === "ERROR" && serverRowSettled(d.server)),
      ).length;
      let slots = MAX_CONCURRENT_DOC_STREAMS - live;
      if (slots <= 0) return prev;
      return prev.map((d) => {
        if (slots > 0 && d.status === "UPLOADED" && d.documentUuid) {
          slots--;
          return { ...d, status: "PROCESSING" as const };
        }
        return d;
      });
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/documents", { cache: "no-store" });
      if (!res.ok) return;
      const snapshot = (await res.json()) as ExistingVendorDocProjection[];
      setDocs((prev) => reconcile(prev, snapshot));
      // A settled row landing on a dead (errored) stream is what frees its
      // client slot — drain the queue on every reconcile.
      promoteQueued();
    } catch {
      // Transient network failure — the next poll tick retries.
    }
  }, [promoteQueued]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const staged: { pointer: string; file: File; bytes: ArrayBuffer }[] = [];
      const rejected: { fileName: string; reason: string }[] = [];
      for (const file of files) {
        if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
          rejected.push({
            fileName: file.name,
            reason: "Tipo no compatible — suba un PNG, JPEG, WebP o PDF.",
          });
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          rejected.push({ fileName: file.name, reason: "El archivo supera el límite de 10 MB." });
          continue;
        }
        if (file.size === 0) {
          // A 0-byte file passes every other check (SPEC §17 C7) but can
          // never process — reject it here with the real cause.
          rejected.push({
            fileName: file.name,
            reason: "El archivo está vacío — expórtelo de nuevo y vuelva a subirlo.",
          });
          continue;
        }
        // Pre-read the bytes NOW — a file changed on disk after selection
        // fails here with the real cause.
        let bytes: ArrayBuffer;
        try {
          bytes = await file.arrayBuffer();
        } catch {
          rejected.push({ fileName: file.name, reason: "No se pudo leer el archivo." });
          continue;
        }
        if (bytes.byteLength !== file.size) {
          rejected.push({
            fileName: file.name,
            reason: "El archivo cambió en el disco después de seleccionarlo — selecciónelo de nuevo.",
          });
          continue;
        }
        staged.push({ pointer: makePointer(), file, bytes });
      }
      if (rejected.length > 0) setIntakeErrors((prev) => [...prev, ...rejected]);
      if (staged.length === 0) return;

      // Optimistic rows.
      setDocs((prev) => [
        ...prev,
        ...staged.map(({ pointer, file }) => ({
          pointer,
          fileName: file.name,
          fileSizeBytes: file.size,
          mediaType: file.type,
          status: "QUEUED" as const,
          retryNonce: 0,
        })),
      ]);
      for (const { pointer, file, bytes } of staged) {
        bytesByPointer.current.set(pointer, bytes);
        filesByPointer.current.set(pointer, file);
      }

      // One intake batch for the round.
      let res: Response;
      try {
        res = await fetch("/api/vendor/upload-intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: staged.map(({ pointer, file }) => ({
              pointer,
              fileName: file.name,
              mimeType: file.type,
              fileSizeBytes: file.size,
            })),
          }),
        });
      } catch {
        for (const { pointer } of staged) {
          update(pointer, {
            status: "UPLOAD_FAILED",
            uploadError: "No se pudo preparar la carga — verifique su conexión.",
          });
        }
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        for (const { pointer } of staged) {
          update(pointer, {
            status: "UPLOAD_FAILED",
            uploadError: body?.error ?? "No se pudo preparar la carga.",
          });
        }
        return;
      }
      const intake = (await res.json()) as UploadIntakeResponse;
      // Per-file server rejections render on the card only — duplicating them
      // into the banner showed the same reason twice.
      for (const failure of intake.failed) {
        update(failure.pointer, {
          status: "UPLOAD_FAILED",
          uploadError: failure.reason,
        });
      }

      // PUT the pre-read bytes to each presigned URL, then promote.
      await Promise.all(
        intake.targets.map(async (target) => {
          const bytes = bytesByPointer.current.get(target.pointer);
          const doc = staged.find((s) => s.pointer === target.pointer);
          if (!bytes || !doc) return;
          update(target.pointer, {
            status: "UPLOADING",
            documentUuid: target.documentUuid,
          });
          try {
            const put = await fetch(target.uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": doc.file.type },
              body: bytes,
            });
            if (!put.ok) throw new Error(`Error al subir (${put.status})`);
            update(target.pointer, { status: "UPLOADED" });
            filesByPointer.current.delete(target.pointer);
          } catch (err) {
            update(target.pointer, {
              status: "UPLOAD_FAILED",
              uploadError:
                err instanceof Error ? err.message : "La carga falló.",
            });
          } finally {
            bytesByPointer.current.delete(target.pointer);
          }
        }),
      );
      promoteQueued();
    },
    [promoteQueued, update],
  );

  const onDocTerminal = useCallback(
    (pointer: string) => {
      update(pointer, { status: "SETTLED" });
      promoteQueued();
      // Converge the durable projection now (SPEC §17 C2) — the poll may be
      // idle once nothing else is in flight, and the settled card must not
      // keep a stale pre-terminal server row.
      void refresh();
      onSettled?.();
    },
    [onSettled, promoteQueued, refresh, update],
  );

  const onDocVM = useCallback(
    (pointer: string, vm: DocVM) => {
      // Content-gated push-up to avoid render storms — a cheap signature over
      // the fields that actually move, not a full JSON serialization per chunk.
      const current = docsRef.current.find((d) => d.pointer === pointer);
      if (current?.liveVM && vmSignature(current.liveVM) === vmSignature(vm)) return;
      update(pointer, { liveVM: vm });
      // A dead stream whose server row already settled frees its client
      // slot now instead of waiting for the next poll reconcile.
      if (vm.status === "ERROR") promoteQueued();
    },
    [promoteQueued, update],
  );

  const tryAgain = useCallback(
    (pointer: string) => {
      const doc = docsRef.current.find((d) => d.pointer === pointer);
      if (!doc?.documentUuid) return;
      update(pointer, {
        // Through the queue, not straight to PROCESSING — a retried doc must
        // respect MAX_CONCURRENT_DOC_STREAMS like every other promotion.
        status: "UPLOADED",
        retryNonce: doc.retryNonce + 1,
        liveVM: undefined,
        actionError: undefined,
        // The settled pre-retry projection must not shadow the new run — with
        // it attached, the retry's settle would render the OLD verdict
        // (serverSettled reads the stale row) until a refresh lands.
        server: undefined,
      });
      promoteQueued();
    },
    [promoteQueued, update],
  );

  /** Retry a failed upload without re-selecting — re-stages the kept File. */
  const retryUpload = useCallback(
    (pointer: string) => {
      const doc = docsRef.current.find((d) => d.pointer === pointer);
      if (!doc || doc.status !== "UPLOAD_FAILED") return;
      const file = filesByPointer.current.get(pointer);
      if (!file) {
        update(pointer, {
          actionError: "El archivo original ya no está en memoria — selecciónelo de nuevo para reintentar.",
        });
        return;
      }
      // A failed PUT leaves the intake's PENDING row behind — clean it up so
      // the retry's fresh intake row doesn't strand an orphan the janitor
      // would later fail and the snapshot poll would resurrect as a phantom
      // card. Best-effort: the janitor is the backstop either way.
      if (doc.documentUuid) {
        void fetch(`/api/vendor/documents/${doc.documentUuid}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      filesByPointer.current.delete(pointer);
      setDocs((prev) => prev.filter((d) => d.pointer !== pointer));
      void addFiles([file]);
    },
    [addFiles, update],
  );

  const deleteDoc = useCallback(
    async (pointer: string) => {
      const doc = docsRef.current.find((d) => d.pointer === pointer);
      if (!doc) return;
      if (!doc.documentUuid) {
        filesByPointer.current.delete(pointer);
        setDocs((prev) => prev.filter((d) => d.pointer !== pointer));
        return;
      }
      try {
        const res = await fetch(`/api/vendor/documents/${doc.documentUuid}`, {
          method: "DELETE",
        });
        if (res.ok) {
          filesByPointer.current.delete(pointer);
          setDocs((prev) => prev.filter((d) => d.pointer !== pointer));
          onSettled?.();
        } else {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          update(pointer, {
            actionError: body?.error ?? "No se pudo eliminar el documento — intente de nuevo.",
          });
        }
      } catch {
        update(pointer, {
          actionError: "No se pudo eliminar el documento — verifique su conexión e intente de nuevo.",
        });
      }
    },
    [onSettled, update],
  );

  // Snapshot poll — on only while an unstreamed server run exists. The effect
  // keys on the derived boolean, not the docs array, so live-stream chatter
  // never resets the timer.
  const anyServerRun = docs.some(
    (d) =>
      (d.server &&
        ["PROCESSING", "UPLOADED", "PENDING"].includes(d.server.uploadStatus) &&
        d.status !== "PROCESSING") ||
      d.status === "UPLOADED",
  );
  useEffect(() => {
    if (!anyServerRun) return;
    const timer = setInterval(() => void refresh(), SNAPSHOT_POLL_MS);
    return () => clearInterval(timer);
  }, [anyServerRun, refresh]);

  return {
    docs,
    addFiles,
    intakeErrors,
    clearIntakeErrors: () => setIntakeErrors([]),
    onDocTerminal,
    onDocVM,
    tryAgain,
    retryUpload,
    deleteDoc,
    refresh,
  };
}

/**
 * Cheap change signature for a live DocVM — tracks every field that affects
 * rendering by length/identity instead of serializing the whole payload.
 */
function vmSignature(vm: DocVM): string {
  const lastTool =
    vm.toolActivity.length > 0 ? vm.toolActivity[vm.toolActivity.length - 1] : undefined;
  let lastToolInputLen = 0;
  if (lastTool?.input !== undefined) {
    try {
      lastToolInputLen = JSON.stringify(lastTool.input)?.length ?? 0;
    } catch {
      lastToolInputLen = 0;
    }
  }
  // Tool states are summed (not just the last tool's) so a non-last tool
  // flipping input-available → output-available still changes the signature.
  let toolStateSum = 0;
  for (const t of vm.toolActivity) {
    toolStateSum +=
      t.state === "input-streaming" ? 1 : t.state === "input-available" ? 2 : t.state === "output-available" ? 3 : 4;
  }
  return [
    vm.status,
    vm.stage ?? "",
    vm.narration ?? "",
    vm.reasoningText?.length ?? 0,
    vm.reasoningStreaming ? 1 : 0,
    vm.toolActivity.length,
    toolStateSum,
    lastTool ? `${lastTool.toolCallId}:${lastTool.state}:${lastToolInputLen}` : "",
    vm.confirmation?.confirmationUuid ?? "",
    vm.extraction ? Object.keys(vm.extraction.extractedData ?? {}).length : -1,
    vm.validation ? (vm.validation.rules?.length ?? 0) : -1,
    vm.terminal?.status ?? "",
    vm.errorText?.length ?? 0,
  ].join("|");
}

/** R5 corollary: only a settled row proves a run's semaphore slot is free. */
function serverRowSettled(
  server: ExistingVendorDocProjection | undefined,
): boolean {
  return (
    !!server && ["PROCESSED", "FAILED", "ERROR"].includes(server.uploadStatus)
  );
}

function serverStatusToClient(
  status: ExistingVendorDocProjection["uploadStatus"],
): ClientDocStatus {
  switch (status) {
    case "PENDING":
    case "UPLOADING":
      return "QUEUED";
    case "UPLOADED":
      return "UPLOADED";
    case "PROCESSING":
      return "SETTLED"; // a server-side run this tab is not streaming — poll reconverges it
    default:
      return "SETTLED";
  }
}

/**
 * Reconcile rules: client-owned docs (QUEUED/UPLOADING/UPLOADED/live
 * PROCESSING) stay authoritative; settled docs adopt the server projection;
 * DB docs missing from the snapshot are dropped (deleted elsewhere); unknown
 * server docs are appended.
 *
 * UPLOADED is client-owned (SPEC §17 C1): the row is waiting for a local
 * stream slot — demoting it to SETTLED here would strand it unprocessed
 * (promotion only considers UPLOADED rows) until the janitor reaps it.
 */
function reconcile(
  prev: ClientDoc[],
  snapshot: ExistingVendorDocProjection[],
): ClientDoc[] {
  const byUuid = new Map(snapshot.map((s) => [s.documentUuid, s]));
  const out: ClientDoc[] = [];
  for (const doc of prev) {
    const clientOwned =
      doc.status === "QUEUED" ||
      doc.status === "UPLOADING" ||
      doc.status === "UPLOAD_FAILED" ||
      doc.status === "UPLOADED" ||
      doc.status === "PROCESSING";
    if (!doc.documentUuid) {
      out.push(doc);
      continue;
    }
    const server = byUuid.get(doc.documentUuid);
    byUuid.delete(doc.documentUuid);
    if (!server) {
      // Deleted elsewhere — drop unless mid-upload on this tab.
      if (clientOwned && doc.status !== "PROCESSING") out.push(doc);
      continue;
    }
    if (clientOwned) {
      // A SETTLED projection cannot describe a run this tab is still
      // streaming — it is the pre-retry verdict, or the poll racing the
      // terminal part. Keep the live fold authoritative (and shed any stale
      // settled row) until the stream itself settles or dies. liveVM
      // undefined counts as alive: the retry stream has not pushed its
      // first fold yet, and re-attaching the old row in that window is the
      // exact bug this guards against.
      const streamAlive =
        doc.status === "PROCESSING" && doc.liveVM?.status !== "ERROR";
      out.push(
        serverRowSettled(server) && streamAlive
          ? { ...doc, server: undefined }
          : { ...doc, server },
      );
    } else {
      // An officer reset (FAILED/ERROR → UPLOADED) must not stay shadowed by
      // the old run's retained fold — shed it so the pill falls through to
      // the server switch ("Procesando") within one poll cycle. A row still
      // PROCESSING keeps the fold: that is the settle race, where the fresh
      // live terminal must win over the stale pre-terminal row.
      const rowReset = ["PENDING", "UPLOADING", "UPLOADED"].includes(
        server.uploadStatus,
      );
      out.push({
        ...doc,
        server,
        status: "SETTLED",
        liveVM: rowReset ? undefined : doc.liveVM,
      });
    }
  }
  for (const server of byUuid.values()) {
    out.push({
      pointer: makePointer(),
      fileName: server.fileName,
      fileSizeBytes: server.fileSizeBytes ?? 0,
      mediaType: "",
      status: "SETTLED",
      documentUuid: server.documentUuid,
      retryNonce: 0,
      server,
    });
  }
  return out;
}
