/**
 * Person-name-matching primitives for document verification.
 *
 * This module is the single source of truth for comparing a document-extracted
 * person name against an expected first/last name. Here it backs the
 * person-name fallback tier of the entity comparator (`compareEntityNames`,
 * entity-names.ts) — sole proprietors and d/b/a names.
 *
 * Document pipelines see two kinds of OCR failure:
 *
 *  1. **Typographic OCR errors on decorative or small-format docs** — ID
 *     cards, licenses, certificates in Old-English / Blackletter. OCR
 *     occasionally transliterates individual glyphs incorrectly (F↔S, I↔T,
 *     O↔Q, 0↔O, 1↔l↔I). These produce a name that is 1-2 characters off.
 *  2. **Structural variants** — hyphenated names, initials, compound names
 *     that appear with or without internal spaces ("LaFears" vs "La Fears"),
 *     middle names, order variants ("Acevedo, Alejandro J.").
 *
 * We tackle both with a tiered comparator that returns a confidence level:
 *
 *   - `clearMatch`  → caller can trust this is the same person
 *   - `ambiguous`   → caller should route to Human-In-The-Loop (HITL)
 *   - `noMatch`     → caller can trust this is NOT the same person
 *
 * Every function in this file is pure and offline — no API calls, no I/O,
 * no randomness. They are safe to use in any context (validators, requirement
 * evaluation, background jobs, SSR pages).
 */

import { areGivenNameVariants, isKnownGivenName } from "./given-name-variants";

// =============================================================================
// Normalization
// =============================================================================

/**
 * Canonicalizes a name for case- and punctuation-insensitive comparison.
 *
 * Pipeline:
 *   1. Unicode NFKD decomposition (separates accents from base letters)
 *   2. Strip combining diacritical marks (U+0300 to U+036F)
 *   3. Lowercase
 *   4. Replace common punctuation with spaces (periods, commas, apostrophes, hyphens)
 *   5. Collapse runs of whitespace
 *   6. Trim
 *
 * Examples:
 *   "Alejandro J. Acevedo-García"  → "alejandro j acevedo garcia"
 *   "O'Sullivan"                   → "o sullivan"
 *   "  LaFears , Jane  "           → "lafears jane"
 */
// Matches combining diacritical marks (U+0300–U+036F). Written as an
// alternation rather than a character class to avoid Biome's
// `noMisleadingCharacterClass` diagnostic — combining marks pair with the
// preceding character to form a new grapheme, so ranges can misbehave.
const COMBINING_MARK_RE =
  /\u0300|\u0301|\u0302|\u0303|\u0304|\u0305|\u0306|\u0307|\u0308|\u0309|\u030A|\u030B|\u030C|\u030D|\u030E|\u030F|\u0310|\u0311|\u0312|\u0313|\u0314|\u0315|\u0316|\u0317|\u0318|\u0319|\u031A|\u031B|\u031C|\u031D|\u031E|\u031F|\u0320|\u0321|\u0322|\u0323|\u0324|\u0325|\u0326|\u0327|\u0328|\u0329|\u032A|\u032B|\u032C|\u032D|\u032E|\u032F|\u0330|\u0331|\u0332|\u0333|\u0334|\u0335|\u0336|\u0337|\u0338|\u0339|\u033A|\u033B|\u033C|\u033D|\u033E|\u033F|\u0340|\u0341|\u0342|\u0343|\u0344|\u0345|\u0346|\u0347|\u0348|\u0349|\u034A|\u034B|\u034C|\u034D|\u034E|\u034F|\u0350|\u0351|\u0352|\u0353|\u0354|\u0355|\u0356|\u0357|\u0358|\u0359|\u035A|\u035B|\u035C|\u035D|\u035E|\u035F|\u0360|\u0361|\u0362|\u0363|\u0364|\u0365|\u0366|\u0367|\u0368|\u0369|\u036A|\u036B|\u036C|\u036D|\u036E|\u036F/g;

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARK_RE, "")
    .toLowerCase()
    .trim()
    .replace(/[.,'’`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips ALL whitespace from a string for space-insensitive comparison.
 *
 * Handles OCR cases where compound names like "LaFears" on an official
 * document may be entered as "La Fears" in the registration form, or
 * vice-versa. Callers compare the stripped-space forms as a secondary check
 * after the normalized substring check fails.
 */
export function stripSpaces(s: string): string {
  return s.replace(/\s/g, "");
}

// =============================================================================
// OCR character substitutions (decorative fonts)
// =============================================================================

/**
 * Equivalence classes of characters that OCR confuses on decorative
 * typefaces (Old-English, Blackletter, ornate seals, small-format ID
 * cards).
 *
 * Each class is collapsed to a single canonical sentinel by
 * `applyOCRSubstitutions()`. After canonicalization, two names that differ
 * only by an OCR-confusable character will compare equal.
 *
 * Rationale (confusions observed on real documents):
 *   - `{f, s, j}`  — decorative "J" often transliterated as "F" or "S"
 *                    (e.g., "Jack" → "Fack" → matcher must still recognize
 *                     "Sack" and "Jack" as plausibly the same name)
 *   - `{i, t, l, 1}` — tall narrow stems; serif "T" top bar is easily dropped
 *   - `{o, q, 0, d}` — round glyphs; "0" and "O" are a classic confusion,
 *                      "Q" without tail renders as "O", "D" can lose the
 *                      closing stroke on thin typefaces
 *   - `{b, 8}`     — stacked-curve confusion on Blackletter
 *
 * This set is intentionally **conservative**: we only include pairs that
 * are routinely confused on the document types we process. Expanding it
 * further relaxes matching enough to admit false positives on document
 * types where exact-match is critical — callers MUST gate this function
 * behind a doc-type allowlist.
 */
const OCR_EQUIVALENCE_CLASSES: ReadonlyArray<ReadonlyArray<string>> = [
  ["f", "s", "j"],
  ["i", "t", "l", "1"],
  ["o", "q", "0", "d"],
  ["b", "8"],
];

/** Precomputed character → sentinel map for O(1) lookup. */
const OCR_CANONICAL_MAP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const klass of OCR_EQUIVALENCE_CLASSES) {
    const sentinel = `\u{2700}${klass[0]}\u{2701}`; // rare control-char wrapper
    for (const ch of klass) {
      map.set(ch, sentinel);
    }
  }
  return map;
})();

/**
 * Replaces every character in its equivalence class with a single sentinel,
 * so OCR-confusable characters collapse to the same canonical form.
 *
 * Example:
 *   applyOCRSubstitutions("Sack") === applyOCRSubstitutions("Jack")
 *   applyOCRSubstitutions("T0m")  === applyOCRSubstitutions("Tom")
 *
 * Expects the input to already be normalized via `normalizeName()`.
 * Callers should ONLY apply this on OCR-heavy doc types (the
 * `OCR_TOLERANT_DOCUMENT_TYPES` allowlist below). Doc types where
 * exact-match is critical must NOT use this substitution.
 */
export function applyOCRSubstitutions(normalized: string): string {
  let out = "";
  for (const ch of normalized) {
    out += OCR_CANONICAL_MAP.get(ch) ?? ch;
  }
  return out;
}

// =============================================================================
// Levenshtein distance (bounded, iterative)
// =============================================================================

/**
 * Computes the Levenshtein edit distance between two strings.
 *
 * Uses the classical O(m·n) dynamic programming table with a single-row
 * optimization. For our use-case (name parts ≤30 chars) this is instantaneous.
 *
 * Early-exit: if `maxDistance` is provided, abandons the computation as soon
 * as every cell in the current row exceeds the threshold — this lets callers
 * cheaply test "is distance ≤2?" without paying full O(m·n).
 *
 * @param a  first string (expected to be lowercased/normalized)
 * @param b  second string (expected to be lowercased/normalized)
 * @param maxDistance  optional early-exit threshold
 * @returns  the edit distance, or `maxDistance + 1` if exceeded and maxDistance provided
 */
export function levenshteinDistance(
  a: string,
  b: string,
  maxDistance?: number,
): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Fast reject: if lengths differ by more than maxDistance, no match possible
  if (
    maxDistance !== undefined &&
    Math.abs(a.length - b.length) > maxDistance
  ) {
    return maxDistance + 1;
  }

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr: number[] = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const insertion = (curr[j - 1] ?? 0) + 1;
      const deletion = (prev[j] ?? 0) + 1;
      const substitution = (prev[j - 1] ?? 0) + cost;
      const cell = Math.min(insertion, deletion, substitution);
      curr[j] = cell;
      if (cell < rowMin) rowMin = cell;
    }
    if (maxDistance !== undefined && rowMin > maxDistance) {
      return maxDistance + 1;
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length] ?? 0;
}

// =============================================================================
// Public comparator
// =============================================================================

/** How confident the matcher is that the two names refer to the same person. */
export type NameMatchConfidence = "clearMatch" | "ambiguous" | "noMatch";

/** Which strategy produced a match on a given name part. */
export type NameMatchStrategy =
  | "exact" // normalized substring match
  | "space-stripped" // substring after stripping spaces (LaFears ↔ La Fears)
  | "ocr" // match after OCR canonicalization (decorative fonts)
  | "nickname" // curated given-name variant (Alex ↔ Alejandro) — given names only
  | "levenshtein" // token-level fuzzy match (typo / OCR glyph error)
  | "abbreviation" // prefix truncation (Christoph ↔ Christopher) — given names only
  | "initial" // single-letter initial (J. ↔ James) — given names only
  | "surname-reordered" // compound surname, all components present in any order (Lopez-Garcia ↔ Garcia Lopez) — surnames only
  | "surname-component" // compound surname, one component present (Lopez-Garcia ↔ Lopez) — surnames only
  | "none"; // no match found

export interface NameComparisonOptions {
  /**
   * If true, apply OCR character substitutions during comparison. Intended
   * for decorative-font-heavy doc types (the `OCR_TOLERANT_DOCUMENT_TYPES`
   * allowlist). Must be false for doc types where exact-match is critical.
   * Default: false.
   */
  enableOcrSubstitution?: boolean;

  /**
   * Maximum Levenshtein distance (per name part, against tokens of the
   * document name) for a fuzzy match. A match at distance ≤ 1 elevates to
   * `clearMatch` on its own; distance 2 only contributes to `ambiguous`
   * unless both parts match at distance ≤ 1. Default: 2.
   */
  levenshteinThreshold?: number;

  /**
   * If true (the default), the FIRST-name comparison additionally admits
   * given-name variants — the curated nickname dictionary ("Alex" ↔
   * "Alejandro", clean), prefix truncations ("Christoph" ↔ "Christopher",
   * ambiguous-grade), and single-letter initials ("J." ↔ "James",
   * ambiguous-grade). Last names never use these tiers — a surname
   * difference is a real signal (family members sharing documents, maiden
   * names) and must not be fuzzed away.
   */
  enableGivenNameVariants?: boolean;
}

export interface NameComparisonResult {
  /** Overall confidence tier — drives downstream HITL vs auto-classify decisions. */
  confidence: NameMatchConfidence;
  /** Did the first name match by any strategy? */
  firstNameMatched: boolean;
  /** Did the last name match by any strategy? */
  lastNameMatched: boolean;
  /** Strategy that produced the first-name match. */
  firstStrategy: NameMatchStrategy;
  /** Strategy that produced the last-name match. */
  lastStrategy: NameMatchStrategy;
  /** Best Levenshtein distance seen for the first name (Infinity if not computed). */
  firstDistance: number;
  /** Best Levenshtein distance seen for the last name (Infinity if not computed). */
  lastDistance: number;
  /** Normalized forms — exposed for HITL dialog payloads and debugging. */
  normalizedExtracted: string;
  normalizedExpectedFirst: string;
  normalizedExpectedLast: string;
}

const DEFAULT_LEVENSHTEIN_THRESHOLD = 2;

/**
 * Compares a document-extracted name against the expected first/last name
 * and returns a tiered confidence result.
 *
 * Matching strategies, tried in order per name part:
 *
 *   1. **Exact substring** — expected name appears as a substring of the
 *      normalized document name. Covers order invariance, middle names,
 *      "Last, First" format.
 *   2. **Space-stripped substring** — expected name appears as a substring
 *      after both sides have all whitespace removed. Covers compound names
 *      like "LaFears"/"La Fears".
 *   3. **OCR-canonicalized substring** (opt-in via `enableOcrSubstitution`)
 *      — same as (1) after applying the OCR equivalence-class canonical map.
 *   4. **Given-name variants** (first name only, on by default)
 *      — curated nickname dictionary ("Alex" ↔ "Alejandro").
 *   5. **Levenshtein fuzzy match** — expected name has distance ≤ threshold
 *      to any whitespace-separated token of the document name.
 *   6. **Prefix truncation** (first name only) — one side is a ≥3-char
 *      prefix of the other ("Christoph" ↔ "Christopher").
 *   7. **Initial** (first name only) — a single-letter token matching the
 *      expected first letter ("A." ↔ "Alejandro").
 *   8. **Compound-surname decomposition** (last name only) — a
 *      multi-component expected surname matches by reordered components
 *      ("Lopez-Garcia" ↔ "Garcia Lopez", clean) or by a single substantial
 *      component ("Lopez-Garcia" ↔ "Lopez", ambiguous-grade).
 *
 * Tiers 5-7 are dictionary-vetoed for given names: two KNOWN dictionary
 * names in disjoint groups ("daniel"/"danielle", "frances"/"francis") never
 * bridge via Levenshtein/prefix — the curation is authoritative that they
 * are different people (same-surname spouse false-positive guard).
 *
 * Confidence aggregation:
 *
 *   - Both parts matched via (1), (2), (3), or (4)         → `clearMatch`
 *   - Both parts matched with Levenshtein distance ≤ 1     → `clearMatch`
 *   - Exactly one part matched (any strategy)              → `ambiguous`
 *   - Both parts matched but one needed Levenshtein ≥ 2,
 *     a prefix truncation, or an initial                   → `ambiguous`
 *   - Neither part matched under any strategy              → `noMatch`
 *
 * Missing/empty expected fields (no firstName OR no lastName) degrade
 * gracefully: an empty expected part counts as "matched" and the overall
 * confidence is driven by whichever part has content. If both expected parts
 * are empty, returns `clearMatch` with a note — the caller should treat this
 * as "no verification was performed" rather than "verified".
 */
export function compareNamesFuzzy(
  extracted: string | null | undefined,
  expected: { firstName: string; lastName: string },
  options: NameComparisonOptions = {},
): NameComparisonResult {
  const {
    enableOcrSubstitution = false,
    levenshteinThreshold = DEFAULT_LEVENSHTEIN_THRESHOLD,
    enableGivenNameVariants = true,
  } = options;

  const normalizedExtracted =
    typeof extracted === "string" ? normalizeName(extracted) : "";
  const normalizedExpectedFirst = normalizeName(expected.firstName ?? "");
  const normalizedExpectedLast = normalizeName(expected.lastName ?? "");

  const baseResult: Omit<NameComparisonResult, "confidence"> = {
    firstNameMatched: false,
    lastNameMatched: false,
    firstStrategy: "none",
    lastStrategy: "none",
    firstDistance: Number.POSITIVE_INFINITY,
    lastDistance: Number.POSITIVE_INFINITY,
    normalizedExtracted,
    normalizedExpectedFirst,
    normalizedExpectedLast,
  };

  // If no expected name at all, we can't verify — treat as noMatch so callers
  // that guard on "at least one expected name" can fall through.
  if (
    normalizedExpectedFirst.length === 0 &&
    normalizedExpectedLast.length === 0
  ) {
    return { ...baseResult, confidence: "noMatch" };
  }

  // If the document name is empty, every part fails to match.
  if (normalizedExtracted.length === 0) {
    return { ...baseResult, confidence: "noMatch" };
  }

  const extractedTokens = normalizedExtracted
    .split(" ")
    .filter((t) => t.length > 0);

  // Given-name variant tiers apply to the first name only (see
  // NameComparisonOptions.enableGivenNameVariants).
  const firstCheck = matchOneName(
    normalizedExpectedFirst,
    normalizedExtracted,
    extractedTokens,
    enableOcrSubstitution,
    levenshteinThreshold,
    enableGivenNameVariants,
  );
  let lastCheck = matchOneName(
    normalizedExpectedLast,
    normalizedExtracted,
    extractedTokens,
    enableOcrSubstitution,
    levenshteinThreshold,
    false,
  );

  // Compound-surname tolerance (marriage-driven hyphenation). The atomic
  // comparison above requires the WHOLE expected surname ("lopez garcia")
  // to appear in the document. A married person whose legal surname is
  // compound routinely holds documents bearing only one component
  // ("Maria Lopez") or the components reordered ("Garcia-Lopez"). Both
  // directions of the single-component case where the DOC carries the
  // compound form are already covered by tier 1 (substring); this fallback
  // covers the expected-side decomposition.
  if (!lastCheck.matched) {
    const componentCheck = matchSurnameComponents(
      normalizedExpectedLast,
      extractedTokens,
    );
    if (componentCheck) lastCheck = componentCheck;
  }

  const result: NameComparisonResult = {
    ...baseResult,
    firstNameMatched: firstCheck.matched,
    lastNameMatched: lastCheck.matched,
    firstStrategy: firstCheck.strategy,
    lastStrategy: lastCheck.strategy,
    firstDistance: firstCheck.distance,
    lastDistance: lastCheck.distance,
    confidence: "noMatch",
  };

  // A missing expected part doesn't count for or against — but if the OTHER
  // part is present and matched cleanly (exact/space-stripped/ocr), that's
  // still a clearMatch. If only one part was present and it matched via
  // Levenshtein only, that's ambiguous.
  const firstExpectedPresent = normalizedExpectedFirst.length > 0;
  const lastExpectedPresent = normalizedExpectedLast.length > 0;

  const bothPresent = firstExpectedPresent && lastExpectedPresent;
  const onlyFirst = firstExpectedPresent && !lastExpectedPresent;
  const onlyLast = !firstExpectedPresent && lastExpectedPresent;

  if (bothPresent) {
    const firstClean = isCleanStrategy(firstCheck.strategy);
    const lastClean = isCleanStrategy(lastCheck.strategy);

    if (firstClean && lastClean) {
      result.confidence = "clearMatch";
    } else if (
      firstCheck.matched &&
      lastCheck.matched &&
      firstCheck.distance <= 1 &&
      lastCheck.distance <= 1
    ) {
      // Both parts matched with tight Levenshtein — treat as clear.
      result.confidence = "clearMatch";
    } else if (firstCheck.matched && lastCheck.matched) {
      // Both matched but at least one is a loose Levenshtein fallback.
      result.confidence = "ambiguous";
    } else if (firstCheck.matched || lastCheck.matched) {
      // Exactly one part matched — clear partial match, needs human.
      result.confidence = "ambiguous";
    } else {
      result.confidence = "noMatch";
    }
  } else if (onlyFirst || onlyLast) {
    const soleCheck = onlyFirst ? firstCheck : lastCheck;
    if (isCleanStrategy(soleCheck.strategy)) {
      result.confidence = "clearMatch";
    } else if (soleCheck.matched) {
      result.confidence = "ambiguous";
    } else {
      result.confidence = "noMatch";
    }
    // The absent part is trivially "matched" (nothing to check)
    if (onlyFirst) {
      result.lastNameMatched = true;
      result.lastStrategy = "exact";
    } else {
      result.firstNameMatched = true;
      result.firstStrategy = "exact";
    }
  }

  return result;
}

/**
 * "clean" strategies are high-confidence — exact, space-stripped, OCR
 * substitution, a curated nickname-group hit, or a fully-reordered compound
 * surname (same components, different order). Prefix truncations, bare
 * initials, and single-component compound-surname hits stay non-clean: they
 * match (so the validator no longer auto-rejects) but aggregate to
 * `ambiguous` for downstream review routing.
 */
function isCleanStrategy(strategy: NameMatchStrategy): boolean {
  return (
    strategy === "exact" ||
    strategy === "space-stripped" ||
    strategy === "ocr" ||
    strategy === "nickname" ||
    strategy === "surname-reordered"
  );
}

/**
 * Minimum length of a compound-surname component for the
 * `surname-component` tier. Filters connective particles ("de", "la",
 * "van", "del") whose presence alone establishes nothing.
 */
const MIN_SURNAME_COMPONENT_LENGTH = 3;

/**
 * Decomposed comparison for a COMPOUND expected surname
 * ("lopez garcia" after `normalizeName` turned the hyphen into a space).
 *
 * - Every substantial component appears as its own document token →
 *   `surname-reordered` (clean-grade: same components, any order — covers
 *   "Garcia-Lopez" ↔ "Lopez-Garcia").
 * - At least one substantial component appears as a document token →
 *   `surname-component` (non-clean: matches, but aggregates to `ambiguous`
 *   — covers a maiden/married single component like "Maria Lopez" against
 *   the compound legal surname "Lopez-Garcia").
 *
 * Single-token expected surnames return null — the main tiers already
 * cover them. `surname-component` reports distance ∞ so the aggregate
 * confidence never upgrades to `clearMatch` via the tight-Levenshtein rule.
 */
function matchSurnameComponents(
  expectedLast: string,
  docTokens: string[],
): SingleMatchResult | null {
  const parts = expectedLast.split(" ").filter((t) => t.length > 0);
  if (parts.length < 2) return null;
  const substantial = parts.filter(
    (p) => p.length >= MIN_SURNAME_COMPONENT_LENGTH,
  );
  if (substantial.length === 0) return null;
  const docSet = new Set(docTokens);
  if (substantial.every((p) => docSet.has(p))) {
    return { matched: true, strategy: "surname-reordered", distance: 0 };
  }
  if (substantial.some((p) => docSet.has(p))) {
    return {
      matched: true,
      strategy: "surname-component",
      distance: Number.POSITIVE_INFINITY,
    };
  }
  return null;
}

interface SingleMatchResult {
  matched: boolean;
  strategy: NameMatchStrategy;
  distance: number;
}

/**
 * Minimum length of the shorter side for a prefix-truncation match
 * ("abbreviation" tier). Below 3 characters a prefix is too weak a signal
 * even for the ambiguous tier ("Jo" would match "Jose", "John", "Joanna"…).
 */
const MIN_ABBREVIATION_PREFIX_LENGTH = 3;

/**
 * Matches a single normalized expected name part against the normalized
 * document name using the tiered strategy described in `compareNamesFuzzy`.
 *
 * Tier order matters: the given-name tiers that produce weaker evidence
 * (abbreviation prefix, initial) run AFTER Levenshtein so a distance-≤1
 * match keeps its clearMatch-grade result (e.g. an OCR-truncated
 * "Alejandr" stays `levenshtein d=1`, it does not downgrade to
 * `abbreviation`). The nickname dictionary runs BEFORE Levenshtein because
 * a curated group hit ("kate" ↔ "kathy") is higher-precision than an edit
 * distance of 2.
 */
function matchOneName(
  expectedPart: string,
  normalizedDoc: string,
  docTokens: string[],
  enableOcrSubstitution: boolean,
  levenshteinThreshold: number,
  enableGivenNameVariants: boolean,
): SingleMatchResult {
  if (expectedPart.length === 0) {
    return {
      matched: false,
      strategy: "none",
      distance: Number.POSITIVE_INFINITY,
    };
  }

  // Tier 1: normalized substring
  if (normalizedDoc.includes(expectedPart)) {
    return { matched: true, strategy: "exact", distance: 0 };
  }

  // Tier 2: space-stripped substring
  if (stripSpaces(normalizedDoc).includes(stripSpaces(expectedPart))) {
    return { matched: true, strategy: "space-stripped", distance: 0 };
  }

  // Tier 3: OCR canonicalization (opt-in)
  if (enableOcrSubstitution) {
    const canonicalDoc = applyOCRSubstitutions(normalizedDoc);
    const canonicalExpected = applyOCRSubstitutions(expectedPart);
    if (canonicalDoc.includes(canonicalExpected)) {
      return { matched: true, strategy: "ocr", distance: 0 };
    }
    if (stripSpaces(canonicalDoc).includes(stripSpaces(canonicalExpected))) {
      return { matched: true, strategy: "ocr", distance: 0 };
    }
  }

  // Tier 4: curated given-name variants (given names only) — "alex" ↔
  // "alejandro", "peggy" ↔ "margaret". Clean-grade: the dictionary is
  // deliberately high-precision (see given-name-variants.ts).
  if (enableGivenNameVariants) {
    for (const token of docTokens) {
      if (areGivenNameVariants(expectedPart, token)) {
        return { matched: true, strategy: "nickname", distance: 0 };
      }
    }
  }

  // Dictionary veto for the weak tiers below. When BOTH given
  // names are known dictionary names that share no variant group ("daniel"
  // vs "danielle", "frances" vs "francis"), the curated dictionary is
  // explicitly asserting they are DIFFERENT people. Levenshtein / prefix
  // matching must not re-bridge them — that is the classic same-surname
  // spouse false positive (post-marriage spouses share the surname, so the
  // given name is the only distinguishing signal). Only applies where the
  // given-name tiers apply at all; unknown names (true typos / OCR damage)
  // are unaffected.
  const isVetoedPair = (token: string): boolean =>
    enableGivenNameVariants &&
    isKnownGivenName(expectedPart) &&
    isKnownGivenName(token) &&
    !areGivenNameVariants(expectedPart, token);

  // Tier 5: Levenshtein distance against any token
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const token of docTokens) {
    if (isVetoedPair(token)) continue;
    const d = levenshteinDistance(expectedPart, token, levenshteinThreshold);
    if (d < bestDistance) bestDistance = d;
    if (bestDistance === 0) break;
  }
  if (bestDistance <= levenshteinThreshold) {
    return {
      matched: true,
      strategy: "levenshtein",
      distance: bestDistance,
    };
  }

  // Tiers 6-7 (given names only): weaker evidence than everything above —
  // they match so the validator stops auto-rejecting, but stay non-clean so
  // the aggregate confidence is `ambiguous` (reviewable), never clearMatch.
  if (enableGivenNameVariants) {
    // Tier 6: prefix truncation — one side is a prefix of the other
    // ("christoph" ↔ "christopher", "ben" ↔ "benjamin" when the dictionary
    // is silent). Requires ≥ MIN_ABBREVIATION_PREFIX_LENGTH chars.
    for (const token of docTokens) {
      if (isVetoedPair(token)) continue;
      const shorter =
        expectedPart.length <= token.length ? expectedPart : token;
      const longer = expectedPart.length <= token.length ? token : expectedPart;
      if (
        shorter.length >= MIN_ABBREVIATION_PREFIX_LENGTH &&
        shorter.length < longer.length &&
        longer.startsWith(shorter)
      ) {
        return {
          matched: true,
          strategy: "abbreviation",
          distance: bestDistance,
        };
      }
    }

    // Tier 7: single-letter initial — the document carries only an initial
    // ("A." for "Alejandro"), or the form itself holds a bare initial.
    for (const token of docTokens) {
      if (token.length === 1 && token === expectedPart[0]) {
        return { matched: true, strategy: "initial", distance: bestDistance };
      }
      if (expectedPart.length === 1 && expectedPart === token[0]) {
        return { matched: true, strategy: "initial", distance: bestDistance };
      }
    }
  }

  return {
    matched: false,
    strategy: "none",
    distance: bestDistance,
  };
}

// =============================================================================
// Convenience helpers
// =============================================================================

/**
 * Boolean shortcut: true if `compareNamesFuzzy` returns `clearMatch`.
 *
 * Preserves the existing boolean semantics of call sites that haven't yet
 * been refactored to handle the `ambiguous` HITL tier. New code should
 * prefer `compareNamesFuzzy()` directly and branch on confidence.
 */
export function namesMatchCleanly(
  extracted: string | null | undefined,
  expected: { firstName: string; lastName: string },
  options?: NameComparisonOptions,
): boolean {
  return (
    compareNamesFuzzy(extracted, expected, options).confidence === "clearMatch"
  );
}

/**
 * Returns true if the names are at least plausibly a match — clearMatch OR
 * ambiguous — so callers that preserve the old permissive-boolean behavior
 * can opt into that explicitly.
 *
 * Most call sites should NOT use this; prefer `namesMatchCleanly` and route
 * `ambiguous` to HITL.
 */
export function namesMatchOrAmbiguous(
  extracted: string | null | undefined,
  expected: { firstName: string; lastName: string },
  options?: NameComparisonOptions,
): boolean {
  const r = compareNamesFuzzy(extracted, expected, options);
  return r.confidence !== "noMatch";
}

/**
 * Doc types for which OCR substitution is appropriate (the decorative-font
 * set: ornate seals, Old-English certificates, small-format cards).
 *
 * The FIRST block holds the live wire values callers actually pass (an
 * earlier revision carried only the legacy names below, so the tier never
 * engaged for the live types — keep this block in sync with the wire
 * values). The SECOND block keeps those legacy names for any older
 * persisted rows or out-of-tree callers.
 *
 * Exposed as a `const` tuple so callers can import and check membership.
 */
export const OCR_TOLERANT_DOCUMENT_TYPES = [
  // Live wire values
  "VALID_DRIVERS_LICENSE",
  "SSN_CARD_SIGNED",
  "GOVERNMENT_ISSUED_ID",
  "SCHOOL_RECORD",
  "SSS_PRINTOUT",
  // Legacy classify-and-extract names (accepted for backward compatibility)
  "DIPLOMA",
  "HIGH_SCHOOL_DIPLOMA",
  "SOCIAL_SECURITY_CARD",
  "DRIVER_LICENSE",
  "SSS_CARD",
] as const;

export type OcrTolerantDocumentType =
  (typeof OCR_TOLERANT_DOCUMENT_TYPES)[number];

/**
 * Returns true if the given document-type string is in the OCR-tolerant
 * allowlist, so callers can decide whether to pass
 * `enableOcrSubstitution: true` to `compareNamesFuzzy`.
 */
export function isOcrTolerantDocumentType(docType: string): boolean {
  return (OCR_TOLERANT_DOCUMENT_TYPES as readonly string[]).includes(docType);
}
