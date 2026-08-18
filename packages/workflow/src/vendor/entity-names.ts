/**
 * Entity-name comparison for vendor documents (insured ↔ W-9 legal name ↔
 * registration). Layered on the tiered person-name comparator
 * (`name-matching.ts`, reused as-is per SPEC §6.5): entity names get
 * legal-suffix normalization + token containment first, and the person
 * comparator serves as the fallback tier (sole proprietors, "John A. Smith
 * d/b/a Smith Consulting").
 *
 * Confidence semantics match the person-name comparator exactly:
 *   - clearMatch → same entity, trust it
 *   - ambiguous  → route to HITL (DBA_SAME_ENTITY confirmation)
 *   - noMatch    → different entity (parent-policy HITL / scoped grant path)
 *
 * Pure and offline — no I/O, no randomness.
 */
import { compareNamesFuzzy, type NameMatchConfidence } from "./name-matching";

/** Legal-form suffixes stripped before comparison. */
const LEGAL_SUFFIXES = new Set([
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "lp",
  "llp",
  "lllp",
  "pllc",
  "pc",
  "plc",
  "pa",
  "dba",
]);

/** Generic trade words that never count as distinctive overlap on their own. */
const GENERIC_TOKENS = new Set([
  "the",
  "and",
  "of",
  "group",
  "holdings",
  "enterprises",
  "services",
  "solutions",
  "systems",
  "consulting",
  "construction",
  "contracting",
  "builders",
  "supply",
  "industries",
  "international",
  "national",
  "global",
  "usa",
  "america",
  "american",
]);

/** Lowercase, strip punctuation/diacritics, drop legal suffixes, collapse. */
export function normalizeEntityName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !LEGAL_SUFFIXES.has(token))
    .join(" ");
}

function tokensOf(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length > 0);
}

export interface EntityComparisonResult {
  confidence: NameMatchConfidence;
  /** Which vendor name the best tier matched against. */
  matchedAgainst: "legal" | "dba" | null;
  /** The tier that decided it — for validation-rule messages/logs. */
  strategy:
    | "exact"
    | "containment"
    | "token-overlap"
    | "person-fallback"
    | "none";
}

function compareAgainstOne(
  extractedNorm: string,
  candidateRaw: string,
): { confidence: NameMatchConfidence; strategy: EntityComparisonResult["strategy"] } {
  const candidateNorm = normalizeEntityName(candidateRaw);
  if (!extractedNorm || !candidateNorm) {
    return { confidence: "noMatch", strategy: "none" };
  }
  if (extractedNorm === candidateNorm) {
    return { confidence: "clearMatch", strategy: "exact" };
  }

  const a = tokensOf(extractedNorm);
  const b = tokensOf(candidateNorm);
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const longerSet = new Set(longer);

  // Containment: every token of the shorter name appears in the longer one,
  // and the shorter name carries at least one non-generic token — the
  // "Acme" ⊂ "Acme Industrial Coatings" case.
  if (
    shorter.length > 0 &&
    shorter.every((t) => longerSet.has(t)) &&
    shorter.some((t) => t.length >= 3 && !GENERIC_TOKENS.has(t))
  ) {
    return { confidence: "clearMatch", strategy: "containment" };
  }

  // Distinctive-token overlap → ambiguous (HITL band): shares at least one
  // distinctive token and half the smaller token set.
  const shared = shorter.filter((t) => longerSet.has(t));
  const distinctiveShared = shared.filter(
    (t) => t.length >= 4 && !GENERIC_TOKENS.has(t),
  );
  if (
    distinctiveShared.length > 0 &&
    shared.length * 2 >= Math.min(a.length, b.length)
  ) {
    return { confidence: "ambiguous", strategy: "token-overlap" };
  }

  // Person-name fallback tier (sole proprietors): the person comparator
  // handles OCR drift, initials, and order variants. Entity-grade caution:
  // its clearMatch demotes to ambiguous (a person-name coincidence is not
  // evidence two ENTITIES are the same).
  if (b.length >= 2) {
    const person = compareNamesFuzzy(extractedNorm, {
      firstName: b[0] ?? "",
      lastName: b[b.length - 1] ?? "",
    });
    if (person.confidence !== "noMatch") {
      return { confidence: "ambiguous", strategy: "person-fallback" };
    }
  }

  return { confidence: "noMatch", strategy: "none" };
}

const CONFIDENCE_RANK: Record<NameMatchConfidence, number> = {
  clearMatch: 2,
  ambiguous: 1,
  noMatch: 0,
};

/**
 * Compare a document-extracted entity name against the vendor's legal name
 * (and DBA when known). The best confidence across candidates wins.
 */
export function compareEntityNames(
  extracted: string | null | undefined,
  expected: { legalName: string; dbaName?: string | null },
): EntityComparisonResult {
  if (typeof extracted !== "string" || extracted.trim().length === 0) {
    return { confidence: "noMatch", matchedAgainst: null, strategy: "none" };
  }
  const extractedNorm = normalizeEntityName(extracted);

  let best: EntityComparisonResult = {
    confidence: "noMatch",
    matchedAgainst: null,
    strategy: "none",
  };
  const candidates: { key: "legal" | "dba"; value: string | null | undefined }[] =
    [
      { key: "legal", value: expected.legalName },
      { key: "dba", value: expected.dbaName },
    ];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const result = compareAgainstOne(extractedNorm, candidate.value);
    if (CONFIDENCE_RANK[result.confidence] > CONFIDENCE_RANK[best.confidence]) {
      best = {
        confidence: result.confidence,
        matchedAgainst: candidate.key,
        strategy: result.strategy,
      };
    }
  }
  return best;
}
