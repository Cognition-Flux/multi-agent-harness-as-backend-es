"use client";

/**
 * One `useChat` per live document (SPEC §7.2) — MOUNTING IS STREAM
 * START. The transport body is ignored server-side; retries carry a nonce in
 * the chat id so cached messages never resurface; a StrictMode-double-invoke
 * guard prevents a duplicate POST → 409 not_claimable.
 */
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai"; // transports import from `ai`, NOT @ai-sdk/react
import { useEffect, useMemo, useRef } from "react";

import { deriveLiveDocVM, type DocVM } from "../lib/doc-vm";
import type { VendorDocUIMessage } from "../lib/vendor-harness-contract";

export interface DocumentProcessorProps {
  pointer: string;
  documentUuid: string;
  retryNonce: number;
  onVM: (pointer: string, vm: DocVM) => void;
  onTerminal: (pointer: string) => void;
}

export function DocumentProcessor({
  pointer,
  documentUuid,
  retryNonce,
  onVM,
  onTerminal,
}: DocumentProcessorProps) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/vendor/documents/${documentUuid}/process`,
      }),
    [documentUuid],
  );
  const { messages, sendMessage, error } = useChat<VendorDocUIMessage>({
    id: `${pointer}#retry-${retryNonce}`,
    transport,
    throttle: 60,
  });

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !documentUuid) return;
    startedRef.current = true;
    void sendMessage({ text: "process" });
  }, [documentUuid, sendMessage]);

  const vm = useMemo(() => deriveLiveDocVM(messages, error), [messages, error]);

  const terminalNotifiedRef = useRef(false);
  useEffect(() => {
    onVM(pointer, vm);
    if (vm.terminal && !terminalNotifiedRef.current) {
      terminalNotifiedRef.current = true;
      onTerminal(pointer);
    }
  }, [vm, pointer, onVM, onTerminal]);

  return null; // headless — the registry renders the card from the pushed VM
}
