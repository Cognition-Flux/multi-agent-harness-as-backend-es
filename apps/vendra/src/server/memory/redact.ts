/**
 * The redaction gate (SPEC §22) — the last thing that runs before a fact
 * becomes durable, on every path.
 *
 * It lives in the memory layer rather than in the assistant because there are
 * now two producers: facts the agent chose through `rememberFacts`, and facts
 * mem0 extracted from a turn on its own. The second is why this is a regex and
 * not a prompt instruction — `customInstructions` asks a model not to keep PII,
 * and this guarantees it.
 */

/**
 * Strip what must never persist: markup first (a stored fact re-enters the
 * prompt inside an XML fence, so angle brackets are an escape vector), then
 * SSN-shaped digits (before the phone matcher can eat them), then EINs
 * (dash form only — the bare 9-digit form is indistinguishable from ids),
 * then phone numbers, then emails.
 */
export function redactMemoryFact(fact: string): string {
  return fact
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, "[redacted-ssn]")
    .replace(/\b\d{2}-\d{7}\b/g, "[redacted-ein]")
    // International (+CC …) numbers FIRST, then the NANP shape. This portal's
    // vendors write Spanish, and "+56 9 1234 5678" sailed straight through a
    // NANP-only matcher; over-redaction is the safe direction here, so any
    // plus-prefixed run of 7–15 digits with common separators goes.
    .replace(/\+\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?)?\d(?:[\s.-]?\d){5,11}\b/g, "[redacted-phone]")
    .replace(
      /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
      "[redacted-phone]",
    )
    // Any non-space local part and domain — \w-based classes miss accented
    // and unicode addresses, which an es-419 audience actually uses.
    .replace(/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}/g, "[redacted-email]")
    .replace(/\s{2,}/g, " ")
    .trim();
}
