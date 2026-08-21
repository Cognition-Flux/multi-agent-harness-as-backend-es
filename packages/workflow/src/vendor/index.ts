/**
 * Pure vendor-compliance engines (SPEC §6.5): document schemas,
 * validators, requirement verification, activation-gate math, coverage
 * determination core, and requirement-evidence derivation.
 *
 * Classification and extraction are performed by the Claude Code harness
 * (apps/vendra/src/server/harness/), which consumes these pure modules —
 * zero `ai`/provider/network imports here by contract.
 */
export * from "./categories";
export * from "./coverage-determination";
export * from "./entity-names";
export * from "./log";
export {
  compareNamesFuzzy,
  type NameComparisonOptions,
  type NameComparisonResult,
  type NameMatchConfidence,
} from "./name-matching";
export * from "./policy";
export * from "./requirement-profile";
export * from "./requirements";
export * from "./schemas";
export * from "./traceability";
export * from "./validators";
