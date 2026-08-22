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
    .replace(
      /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
      "[redacted-phone]",
    )
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[redacted-email]")
    .replace(/\s{2,}/g, " ")
    .trim();
}
