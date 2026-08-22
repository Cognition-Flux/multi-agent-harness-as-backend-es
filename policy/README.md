# vendra policy checks (dev-time)

Rego mirrors of this repo's decision logic, used as a **second opinion** on the
TypeScript engines in `packages/workflow/src/vendor/` — plus, since SPEC §19, one
policy the **app itself evaluates**.

Read that second part carefully, because this directory is no longer purely
dev-time: `company-policy.rego` is compiled to the committed
`company-policy.wasm`, which `apps/vendra/src/server/policy-admission.ts` loads
in-process to admit or reject a proposed company policy **at activation**. That
is the only OPA in the product, it runs a handful of times per company, and the
request path never touches it. Everything else here is offline `opa eval` /
`opa test` with no server.

```bash
bash policy/run-checks.sh        # also: pnpm policy:check
```

Since SPEC §23.12 the suite also gates pushes: activate the committed hook once
per clone with `pnpm hooks:install` (= `git config core.hooksPath .githooks`);
`.githooks/pre-push` runs this suite plus the app type-check, with
`VENDRA_SKIP_CHECKS=1 git push` as the emergency escape hatch.

Findings and the reasoning behind each check: `docs/opa-applications.md`.

| File | Mirrors | Asks |
|---|---|---|
| `profiles.rego` | `vendor_requirement_profile` rows × `VENDOR_REQUIREMENT_MAP` | can every required category ever be granted? |
| `gate.rego` | `calculateActivationGate` + `deriveAutoDismissedCategories` | do the gate's invariants hold across all 16,384 states, and does the SPEC §18 D1 tie-break pick the same subset regardless of column order? |
| `coverage.rego` | `validateCoverageDetermination` | does any payload get past the gate that the payload contract forbids? |
| `repo.rego` | `docker-compose.yml`, the `package.json` files, the harness pins, `auth.ts` | do the eight hard rules in `.claude/CLAUDE.md` still hold? |
| `policy-resolver.rego` | the referee boundary in `deriveRequirementEvidence` | is an officer source ever withheld? does the boundary bite? **does this suite catch the direction inversion that shipped once?** |
| `company-policy.rego` | — (it IS the policy the app runs) | is a proposed company policy admissible? Thirteen rejection rules, two warnings |
| `verify-engine-invariants.ts` | the engines themselves | the properties Rego cannot express, because it cannot call TypeScript |

Run everything with `bash policy/run-checks.sh`. Rebuild the Wasm artifact after
editing `company-policy.rego` with `pnpm --filter vendra policy:build` — which
runs the tests first and writes `company-policy.wasm.json`, the manifest
`repo.rego` uses to detect a **stale artifact by content hash** (mtime is
meaningless after a clone), to check the entrypoint against the string the app
calls, and to check the module's host built-ins against the six `opa-wasm` ships.

`verify-engine-invariants.ts` is the answer to a specific problem: several
properties the spec asserts (§19.2's validator enumeration, §19.6's no-op,
§6.6's coverage solvability) were verified once by ephemeral scripts and then
deleted per rule 3, leaving the spec claiming things nothing checked. Rego cannot
call the engines, so those live in TypeScript, and rule 3 now carries a
`policy/**` clause so the rule matches the tree.

### Two ways facts get in, and why it matters

`repo.rego` reads facts regenerated from the **real files on every run** by
`extract-repo-facts.py` (compose YAML, the `package.json` files, and greps over
`.ts` sources). Nothing is committed, so that check cannot pass against a stale
copy.

`data/profiles.json` and `data/coverage-cases.json` are **copies** of TypeScript
constants — the seeded profiles from `server/seed-demo.ts`, the category catalog,
the document→category map, and the adversarial payloads. They go stale silently
when the engines change. Re-derive them when touching
`packages/workflow/src/vendor/`. Since §23.12, `coverage-cases.json` is no
longer prose-only: run-checks passes it to the coverage suite, and each case's
`expect` array (deny-message prefixes) is asserted table-driven — a truncated or
un-passed file FAILS the suite instead of silently checking nothing.

### The capability pin

`capabilities-pinned.json` is `opa capabilities --current` minus `http.send`,
`net.lookup_ip_addr` and `opa.runtime`. Every `opa check`/`opa test` invocation
in `run-checks.sh` passes it, so a policy that reaches the network fails to
compile (`rego_type_error: undefined function http.send`) rather than being
caught in review. That is repo rule 1 enforced on the checking tool itself.
Regenerate it with the snippet in `run-checks.sh`'s header comment after an OPA
upgrade. Since §23.12 run-checks also diffs the pin against
`opa capabilities --current` on every run: a pin referencing built-ins or ABI
versions the installed binary lacks fails loudly (that would break every suite
silently), while the pin's deliberate subsetting stays legal.

## Reproducing the differential against the real TS

The Rego is only a mirror; each finding was confirmed by running the actual
engine. Test scripts are not committed (project rule 3), so recreate this one
ad hoc under `apps/vendra/scripts/`, run it, and delete it:

```ts
import { calculateActivationGate, type RequirementProfile, type GrantSource,
         type RequirementCategoryType } from "@vendra/workflow/vendor";

const profile: RequirementProfile = {
  required: ["TAX_IDENTITY", "DIVERSITY_CERTIFICATION", "SAFETY_RECORD"] as RequirementCategoryType[],
  mandatory: ["TAX_IDENTITY"] as RequirementCategoryType[],
  dismissible: ["DIVERSITY_CERTIFICATION", "SAFETY_RECORD"] as RequirementCategoryType[],
  maxManualDismissable: 1,
};
const granted = new Map<RequirementCategoryType, GrantSource[]>([
  ["TAX_IDENTITY" as RequirementCategoryType, [{ kind: "document", expiresAt: null }]],
  ["DIVERSITY_CERTIFICATION" as RequirementCategoryType, [{ kind: "document", expiresAt: null }]],
]);
for (const order of [["DIVERSITY_CERTIFICATION", "SAFETY_RECORD"],
                     ["SAFETY_RECORD", "DIVERSITY_CERTIFICATION"]]) {
  const gate = calculateActivationGate({
    profile, granted, waived: new Map(),
    manualDismissed: new Set(order as RequirementCategoryType[]),
    autoDismissed: new Set(), now: new Date("2026-08-20T12:00:00Z"),
  });
  console.log(order, gate.cleared, gate.honoredManual, gate.blocking);
}
```

```bash
nvm use 22 && pnpm --filter vendra exec tsx scripts/<name>.ts && rm apps/vendra/scripts/<name>.ts
```

Same shape for the coverage payloads: feed each `data/coverage-cases.json` entry
to `validateCoverageDetermination(payload, new Set(allowed), thresholds)` and
compare its verdict with `data.vendra.checks.coverage.decision`.

## Traps this directory already hit

- **A package path that shadows a data key is a recursion error.** `package
  vendra.profiles` reading `data.vendra.profiles` fails to compile with
  `rego_recursion_error` — hence the `vendra.checks.*` namespace.
- **`opa test`'s default 5 s per-test timeout kills state-space suites.**
  `gate_test.rego` needs `--timeout 300s`; without it every test reports
  `eval_cancel_error: context deadline exceeded`, which reads like a policy bug.
- **A mocked-input test caught a hardcoded assumption in the model itself** —
  `honoured_options` generated pairs regardless of the cap, so it only agreed
  with the engine for `maxManualDismissable: 2`. Mock the config, not just the
  input.
- **Grep precision is a correctness property.** `repo.rego`'s rule-7 check first
  flagged `apps/vendra/src/server/auth.ts` for `"pg"` — which is
  `provider: "pg"`, the Drizzle dialect name, not a driver import. The extractor
  matches `from "pg"` / `require("pg")` only. A rule that over-matches is worse
  than no rule: it trains you to ignore the output.
