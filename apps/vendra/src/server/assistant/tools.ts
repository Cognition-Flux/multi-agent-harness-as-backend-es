/**
 * Host-executed tools for the vendor assistant's Claude Code session.
 *
 * All reads flow through the snapshot module (same derivations as the
 * page); the one write is the memory service. Every tool soft-fails with
 * { ok: false, note } — a thrown tool error would kill the live stream.
 */
import { tool } from "ai";

import { vendraError } from "@/server/harness/log";

import {
  getComplianceStateInputSchema,
  getDocumentDetailsInputSchema,
  rememberFactsInputSchema,
} from "@/features/vendor-compliance/lib/vendor-harness-contract";

import { rememberFacts } from "./memory";
import { buildComplianceState, buildDocumentDetails } from "./snapshot";

export interface AssistantToolContext {
  vendorUuid: string;
  vendorId: number;
}

/** Build the three host tools bound to one vendor's chat session. */
export function buildAssistantTools(ctx: AssistantToolContext) {
  const getComplianceState = tool({
    description:
      "Get the vendor's whole compliance record right now: requirement categories with status, the activation gate, every uploaded document with processing/validation state, the insurance-coverage determination, and upcoming expirations. Call before answering any status/progress question.",
    inputSchema: getComplianceStateInputSchema,
    execute: async () => {
      try {
        return await buildComplianceState(ctx.vendorId);
      } catch (err) {
        vendraError("assistant.tool_failed", {
          vendor: ctx.vendorUuid,
          tool: "getComplianceState",
          err: err instanceof Error ? err.message : String(err),
        });
        return {
          ok: false,
          note: "Compliance state is unavailable right now.",
        };
      }
    },
  });

  const getDocumentDetails = tool({
    description:
      "Get one uploaded document in depth: classification reasoning, extracted fields, and per-rule validation results. Use the documentUuid from getComplianceState.",
    inputSchema: getDocumentDetailsInputSchema,
    execute: async ({ documentUuid }) => {
      try {
        const details = await buildDocumentDetails(
          ctx.vendorId,
          documentUuid,
        );
        return (
          details ?? { ok: false, note: "No document with that id exists." }
        );
      } catch (err) {
        vendraError("assistant.tool_failed", {
          vendor: ctx.vendorUuid,
          tool: "getDocumentDetails",
          err: err instanceof Error ? err.message : String(err),
        });
        return {
          ok: false,
          note: "Document details are unavailable right now.",
        };
      }
    },
  });

  const rememberFactsTool = tool({
    description:
      "Store up to 5 short durable facts the vendor told you about their business, for future sessions. Never store assistant output, document contents, or contact/tax details.",
    inputSchema: rememberFactsInputSchema,
    execute: async ({ facts }) => {
      const stored = await rememberFacts(
        ctx.vendorUuid,
        ctx.vendorId,
        facts,
        ctx.vendorUuid,
      );
      return { stored };
    },
  });

  return {
    getComplianceState,
    getDocumentDetails,
    rememberFacts: rememberFactsTool,
  };
}
