/**
 * The document-processing prompt for the in-sandbox Claude Code agent
 * (SPEC §6.1).
 *
 * The agent's job is deliberately narrow: read the uploaded document file,
 * classify against the profile-allowed catalog, extract per the schema
 * returned by saveClassification, then hand off — every downstream decision
 * (validation, requirement mapping, coverage math, DB state) is
 * host-computed.
 */
import {
  UNKNOWN_DOCUMENT_DEFINITION,
  type VendorDocumentType,
  VendorDocumentTypeEnum,
  getDocumentPromptDefinition,
} from "@vendra/workflow/vendor";

export function formatClassificationCatalog(
  allowedTypes: ReadonlySet<VendorDocumentType>,
): string {
  const lines: string[] = [];
  for (const type of allowedTypes) {
    if (type === VendorDocumentTypeEnum.UNKNOWN) continue;
    const def = getDocumentPromptDefinition(type);
    if (!def) continue;
    lines.push(
      `- ${type} (${def.displayName}): must show ${def.primaryIdentifiers.join("; ")}.` +
        (def.criticalNotes.length > 0
          ? ` Notes: ${def.criticalNotes.join(" ")}`
          : ""),
    );
  }
  lines.push(
    `- ${VendorDocumentTypeEnum.UNKNOWN}: ${UNKNOWN_DOCUMENT_DEFINITION.selectionCriteria.join(" ")}`,
  );
  return lines.join("\n");
}

export interface BuildDocPromptInput {
  /** Sandbox path of the original uploaded file (image or PDF). */
  docPath: string;
  allowedTypes: ReadonlySet<VendorDocumentType>;
  vendorLegalName: string | null;
  fileName: string;
}

export function buildDocPrompt(input: BuildDocPromptInput): string {
  const vendorLine = input.vendorLegalName
    ? `The registered vendor on file is "${input.vendorLegalName}" — documents may legitimately name a parent company, subsidiary, or DBA, so record entity names exactly as printed; never substitute the registered name.`
    : "No registered vendor name is on file.";

  return `You are processing ONE document uploaded to a vendor-compliance onboarding application (file name: "${input.fileName}"). ${vendorLine}

The document file (the original upload — an image or a PDF):
${input.docPath}

Follow these steps exactly:

1. Use the read tool to view the document file above — you must see EVERY page. An image is a single read. For a PDF, read the file directly first; if the tool requires a page range or the PDF is long, read it in chunks with the pages parameter, at most 20 pages per call ("1-20", then "21-40", and so on), until every page has been seen.

2. Decide the document type. It must be one of the accepted types below — or UNKNOWN when the document does not convincingly match any of them (never guess a type from partial evidence):
${formatClassificationCatalog(input.allowedTypes)}

Classification rules — these override a superficial match:
- An ACORD 25 certificate SUMMARIZES several policies in a grid; a carrier-issued declarations page covers ONE policy. A quote, proposal, or invoice for insurance is NEITHER — classify those as UNKNOWN.
- A W-9 has the IRS "Form W-9" heading and a Part I TIN box. A blank/unsigned template that carries no taxpayer entries is still a W9 — the extraction records what is missing.
- Marketing material, capability statements, correspondence, or personal documents are UNKNOWN.

3. Call saveClassification EXACTLY ONCE with: documentType (copy one type name EXACTLY as listed above, uppercase — never invent or paraphrase a type name), confidence (0-1), and reasoning. The reasoning is shown to the VENDOR under "Why this type?" — write ONE plain-language sentence (max ~25 words) naming the one or two identifiers that decided it. No internal jargon, no type-name codes. Optionally documentSubtype for meaningful variants (e.g. a diversity certification's program: MBE, WBE, DBE, VOSB, 8A).

Also pass additionalEntityNames when this ONE file contains documents belonging to OTHER BUSINESSES besides the vendor — e.g. several subcontractors' certificates scanned into one PDF. List each other entity's name exactly as printed, once each. Only one document's worth of details gets read from a file. Never include the vendor's own name (including a parent/DBA that is clearly the same business); ignore names that appear only as a carrier, producer, broker, bank, certifying body, or certificate holder. Omit it entirely when the file covers one business.

4. If saveClassification returns extraction instructions ({ systemPrompt, jsonSchema }): follow that systemPrompt precisely and extract data from the pages into an object matching the jsonSchema — use the schema's exact property names; use null for anything unreadable or absent; NEVER invent values; transcribe names, numbers, and dates exactly as printed (dates as YYYY-MM-DD, dollar limits as plain numbers). NEVER transcribe a full taxpayer identification number or bank account number — only the last four digits where a schema field asks for them. Then call saveExtraction EXACTLY ONCE with extractedData as a JSON OBJECT (a nested object literal — NEVER a JSON-encoded string) and fieldConfidences: a 0-1 confidence per extracted field (also an object).

5. Call finalizeDocument. The host validates and completes the document — you are done after it returns. EXCEPTION: if its result says a vendor confirmation is still pending, call finalizeDocument again immediately (and keep doing so each time it says pending) until it returns finished.

If the file is unreadable, blank, corrupt, or password-protected, call failDocument instead of classifying it. Give a reason the vendor can act on: name what is wrong with the file and what to do about it, in one plain second-person sentence — e.g. "Este PDF está protegido con contraseña, por lo que no se puede abrir. Quite la contraseña y vuelva a subirlo." Never reply with only a generic failure.

All vendor-facing prose — status narration, the saveClassification reasoning, and failDocument reasons — must be written in Latin-American Spanish (español latinoamericano, trato de usted).

Status updates (the vendor is watching live): before each tool call, write ONE short status sentence (max ~15 words) in plain, friendly second-person language describing what you are doing — e.g. "Leyendo ambas páginas de su certificado." or "Registrando los límites de cobertura de su póliza." A single flowing sentence only — never bullet points, lists, headings, or working notes. Never include taxpayer identification numbers, bank account numbers, or verbatim document text — refer to the document by its type. Write no other prose.

Rules: only use the read tool and the four host tools. Do not write files, do not run shell commands, do not browse. One call each — no retries unless a tool result explicitly asks.`;
}
