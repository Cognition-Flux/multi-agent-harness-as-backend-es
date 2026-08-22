/**
 * The live-document view model (SPEC §7.2) — FOLD, don't accumulate:
 * every render folds the whole `messages` array into one DocVM. The
 * canonical extraction part wins over any streaming fold; the last text line
 * is the narration; tool parts normalize from BOTH `dynamic-tool` and
 * `tool-*` shapes.
 */
import type {
  ProcessingStage,
  VendorDocConfirmationPart,
  VendorDocExtractionPart,
  VendorDocTerminalPart,
  VendorDocUIMessage,
  VendorDocValidationPart,
} from "./vendor-harness-contract";

export type ToolLifecycle =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export interface DocToolActivity {
  toolCallId: string;
  name: string;
  state: ToolLifecycle;
  /** Partial during input-streaming — consumers must optional-chain. */
  input?: unknown;
  errorText?: string;
}

export interface DocVM {
  /** PROCESSING until a terminal part lands; ERROR on transport error. */
  status: "PROCESSING" | "PROCESSED" | "FAILED" | "ERROR";
  stage?: ProcessingStage;
  narration?: string;
  reasoningText?: string;
  /** True while the LAST reasoning part is still streaming (honest shimmer gate). */
  reasoningStreaming?: boolean;
  extraction?: VendorDocExtractionPart;
  validation?: VendorDocValidationPart;
  /** The OPEN confirmation (settled windows clear it). */
  confirmation?: VendorDocConfirmationPart;
  terminal?: VendorDocTerminalPart;
  toolActivity: DocToolActivity[];
  errorText?: string;
}

type AnyPart = VendorDocUIMessage["parts"][number];

export function deriveLiveDocVM(
  messages: VendorDocUIMessage[],
  chatError?: Error,
): DocVM {
  const vm: DocVM = { status: "PROCESSING", toolActivity: [] };
  const toolByCallId = new Map<string, DocToolActivity>();
  let reasoning = "";

  for (const message of messages) {
    for (const part of message.parts as AnyPart[]) {
      switch (part.type) {
        case "data-vendor-doc-stage": {
          const data = (part as { data: { status: string; stage?: ProcessingStage } }).data;
          if (data.stage) vm.stage = data.stage;
          break;
        }
        case "data-vendor-doc-extraction": {
          vm.extraction = (part as { data: VendorDocExtractionPart }).data;
          break;
        }
        case "data-vendor-doc-validation": {
          vm.validation = (part as { data: VendorDocValidationPart }).data;
          break;
        }
        case "data-vendor-doc-confirmation": {
          const data = (part as { data: VendorDocConfirmationPart }).data;
          // Data parts replace in place by id — `settled` clears the prompt.
          if (data.settled) {
            if (vm.confirmation?.confirmationUuid === data.confirmationUuid) {
              vm.confirmation = undefined;
            }
          } else {
            vm.confirmation = data;
          }
          break;
        }
        case "data-vendor-doc-terminal": {
          vm.terminal = (part as { data: VendorDocTerminalPart }).data;
          break;
        }
        case "text": {
          const text = (part as { text?: string }).text;
          if (typeof text === "string" && text.trim().length > 0) {
            vm.narration = text.trim();
          }
          break;
        }
        case "reasoning": {
          const p = part as { text?: string; state?: "streaming" | "done" };
          if (typeof p.text === "string") reasoning += p.text;
          // Later parts overwrite — the fold tracks the LAST block's state.
          vm.reasoningStreaming = p.state === "streaming";
          break;
        }
        case "dynamic-tool": {
          const p = part as {
            toolCallId?: string;
            toolName?: string;
            state?: ToolLifecycle;
            input?: unknown;
            errorText?: string;
          };
          if (p.toolCallId && p.toolName && p.state) {
            toolByCallId.set(p.toolCallId, {
              toolCallId: p.toolCallId,
              name: p.toolName,
              state: p.state,
              input: p.input,
              ...(p.errorText ? { errorText: p.errorText } : {}),
            });
          }
          break;
        }
        default: {
          if (part.type.startsWith("tool-")) {
            const p = part as unknown as {
              toolCallId?: string;
              state?: ToolLifecycle;
              input?: unknown;
              errorText?: string;
            };
            if (p.toolCallId && p.state) {
              toolByCallId.set(p.toolCallId, {
                toolCallId: p.toolCallId,
                name: part.type.slice("tool-".length),
                state: p.state,
                input: p.input,
                ...(p.errorText ? { errorText: p.errorText } : {}),
              });
            }
          }
        }
      }
    }
  }

  vm.toolActivity = [...toolByCallId.values()];
  if (reasoning.trim().length > 0) vm.reasoningText = reasoning.trim();

  if (vm.terminal) {
    vm.status = vm.terminal.status === "COMPLETED" ? "PROCESSED" : "FAILED";
    vm.confirmation = undefined;
  } else if (chatError) {
    vm.status = "ERROR";
    vm.errorText = chatError.message;
  }
  return vm;
}
