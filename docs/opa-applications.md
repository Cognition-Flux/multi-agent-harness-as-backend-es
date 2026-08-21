# OPA / Rego in vendra — where a policy engine earns its keep

A dev-time assessment of `.claude/skills/opa`, which shipped with an explicit
disclaimer: *"that is a boundary statement, not a recommendation; no adoption
assessment was performed."* This is that assessment. It is deliberately
**dev-time only** — nothing here is imported by `apps/` or `packages/`, no
container was added, no `opa` server runs, and the app's external reliance is
unchanged.

Candidates here are not just reasoned about but **run**: six policies under
`policy/`, 86 passing `opa test` assertions plus 36 TypeScript engine
invariants, and every finding re-confirmed against the real engine before it was
written down. OPA 1.19.1, Rego v1.

**One thing changed after this assessment was written.** It concluded dev-time
only, and that held for the review candidates — but SPEC §19 then adopted OPA in
app code for exactly one job: admitting a proposed per-company document policy at
**activation time**, in-process via Wasm. §8 covers that. Everything else here
still stands, including the anti-candidate that keeps a policy engine off the
request path.

§3 is the first pass, which found three defects and fixed none of them by
design. **§7 is the second pass**, where those findings are closed as SPEC §18
D1/D2 — including two bugs introduced *by* the fixes and caught by re-running
the same suites.

```bash
bash policy/run-checks.sh
```

---

## 1. Why the fit is real — and where it isn't

vendra's architecture draws a hard line: the agent decides classification and
extraction, and **everything downstream is deterministic host code** —
validation, requirement mapping, coverage math, the activation gate. That
downstream is 4,451 lines of pure, `now`-injected TypeScript in
`packages/workflow/src/vendor/`. Deterministic adjudication over structured
facts is precisely Rego's domain.

The tempting pitch — *"move the rules into policy so they become
configurable"* — **does not apply here**, and any assessment that leads with it
is selling something. Profiles are already data: `vendor_requirement_profile`
rows carry `required`, `mandatory`, `dismissible`, `thresholds` (jsonb) and
`maxManualDismissable` per organization, and `server/profile.ts` maps them into
the engines. Configurability is solved.

What is *not* solved is **interrogability**. A TypeScript function answers "what
is the verdict for this input?" — one input at a time, and only for inputs
someone thought to try. A Rego rule answers "does this property hold across the
whole input space?", and `opa eval` will enumerate that space for you. The three
spikes below are all the same move: take a claim the code makes in a comment,
and ask the whole state space whether it is true.

That reframing is the finding of this assessment. The value is not a runtime
policy engine. It is a **second opinion on the adjudication core** — and it
found three things.

---

## 2. Boundary rulings

| OPA feature | Ruling | Why |
|---|---|---|
| `opa eval` / `opa test` locally | **In bounds** | Dev tooling, fully offline, rule 1's tooling exemption |
| Committed `*.rego` + `*_test.rego` | **In bounds** | Treated as policy source, not test files (explicit carve-out from rule 3) |
| `opa run --server` sidecar in compose | **Not taken** | The other in-bounds shape. Wasm won instead (§9): no service to supervise, no availability coupling, no loopback hop. A sidecar would also need `--skip-version-check`, since a default `opa run` GETs `api.github.com` on startup |
| In-process Wasm (`@open-policy-agent/opa-wasm`) | **Adopted** (§8) | For activation-time admissibility only. The built module needs exactly one host built-in, `sprintf`, which is among the SDK's six — so no `customBuiltins`, and `repo.rego` asserts that stays true |
| Compile API → **SQL** data filtering | **Out** | Rule 7: string-built SQL and `sql.raw` are banned; every query goes through the Drizzle builder. A UCAST→Drizzle translator is the only conceivable variant and is a large lift for no current need |
| Bundle service, discovery, decision-log & status upload, OCP | **Out** | Rule 1: every one is an outbound call to a host this repo does not own |
| Gatekeeper, Envoy plugin | **Out** | No Kubernetes, no service mesh |
| OPA replacing zod at the harness tool boundary | **Out** | Rules 2 and 5: the contract is one module, and tool IO is zod-parsed by design |

---

## 3. What was found

### Finding 1 — the activation gate is order-dependent

`calculateActivationGate` honours manual dismissals with
`[...input.manualDismissed].filter(qualifying).slice(0, cap)`. `Set` iteration
follows insertion order, and the set is built from `vendor.dismissed_categories`
— a `text[]` column. So **which** dismissals are honoured is decided by array
order, and the profile says nothing about which ones should win.

`policy/gate.rego` mirrors the gate order-independently and enumerates every
satisfaction state (`none` / `grant_active` / `grant_expired` /
`waiver_expired`) across 5 categories × 8 manual-dismissal subsets × remote-only
on/off = **16,384 scenarios**. Where more dismissals qualify than the cap
allows, it computes the outcome for *every* admissible honoured subset:

```
scenarios         16384
order_sensitive      96      <- activation differs depending on which subset wins
invariant_violations  0      <- for all five invariants (see below)
```

Feeding those 96 scenarios to the real engine, permuting the array each time:
**96 of 96 flip `cleared`.** Minimal repro — same vendor, same evidence, same
profile, two orderings of one column:

```
dismissed_categories = ["DIVERSITY_CERTIFICATION","SAFETY_RECORD"]
  -> cleared=false  honored=["DIVERSITY_CERTIFICATION"]  blocking=["SAFETY_RECORD"]
dismissed_categories = ["SAFETY_RECORD","DIVERSITY_CERTIFICATION"]
  -> cleared=true   honored=["SAFETY_RECORD"]            blocking=[]
```

The mechanism is a *wasted* dismissal: the cap spends its budget on a category
that already has an unexpired grant, and the still-unsatisfied one stays
blocking.

**Reachability, stated precisely.** The only writer of `dismissed_categories` is
`/api/vendor/registration` (`route.ts:76`), which rejects over-cap payloads —
"Round-2 hardening B1", and it works. So with a *fixed* profile this is not
reachable through the API today. It reopens when:

1. an org lowers `maxManualDismissable`, or removes a category from
   `dismissible`, **after** a vendor's toggles are persisted — nothing
   re-validates the stored array, and the column has no DB-level constraint
   (`test_lowered_cap_reopens_order_sensitivity` covers exactly this);
2. any second writer of that column appears;
3. a seed or migration writes it directly.

The invariant is enforced in one route, one call deep, while the function that
consumes it is order-sensitive. Cheapest fixes: sort (or apply a stated
priority) before `.slice()`, so the honoured subset is a function of the *set*;
or have the gate refuse an over-cap array instead of silently truncating it.

**The negative result matters too.** All four invariants the gate's comments
claim — no double credit for a dismissed category, mandatory never absorbed by
dismissals, honoured dismissals within cap and scope, expired grants and waivers
never satisfy — **hold across all 16,384 scenarios**. That is the hardening the
comments describe, confirmed rather than assumed.

### Finding 2 — the coverage gate accepts five payloads its own contract forbids

`validateCoverageDetermination` is the host's defence against a bad
`saveCoverageDetermination` call: it returns the **first** failure reason, which
the runner hands back to the agent to retry. `policy/coverage.rego` re-expresses
it as a partial `deny` set (all failures at once) plus a `gap` set for rules the
payload contract *states* but the host does not enforce.

Twelve adversarial payloads went through both. The mirror and the host **agree
on every accept/reject decision (12/12)** — 7 rejections match message for
message, including the §16 B12 shape ("claimed 999,999 / BELOW with
contributions summing to 1,000,000"). The interesting half is the 5 the host
accepts:

| Payload | Host | What gets persisted |
|---|---|---|
| `BELOW` with `effectiveOccurrenceLimitUsd: null` | **accepted** | a null limit — while the host's own refusal copy states *"null is only legal with verdict UNDETERMINED"*. Only `MEETS` is actually checked |
| `lines: []` | **accepted** | an empty determination, stamped with the current signature and therefore **fresh** — so no coverage category is ever granted and the lane will not re-run until an input changes |
| contributions `+2,000,000` and `−1,000,000` | **accepted** | `effective = 1,000,000`. Nothing bounds `amountAppliedUsd` from below, so offsetting entries satisfy the ±1% re-derivation with invented arithmetic |
| `effectiveAggregateLimitUsd: 1` alongside a 1,000,000 occurrence limit | **accepted** | an aggregate below its own per-occurrence limit, and far below the profile's `gl_aggregate_usd` of 2,000,000. The aggregate figure is **never validated** — not re-derived, not compared to any threshold |
| `UNDETERMINED` with a resolved 5,000,000 limit | **accepted** | a false negative: the vendor stays blocked on coverage the payload demonstrates |

One structural observation behind all of them: the signature is
`validateCoverageDetermination(payload, allowedUuids, thresholds)`. The host
re-derives the payload's *internal* consistency, but the extracted per-document
limits are never passed in — so no check can anchor `amountAppliedUsd` to what
the document actually said. The host has that data when it builds the prompt;
an anchor gate is enforceable, and today's gate cannot express one.

### Finding 3 — one catalog category can never be satisfied

`policy/profiles.rego` checks each profile against the document catalog and the
*implemented* grant paths. The two seeded presets (`construction-sub`,
`general-supplier`) come back **clean** — no structural violations, no warnings.

The trap is one category away. `SANCTIONS_SCREENING` ships in the catalog with a
label, is accepted by the unconstrained `required text[]` column, and:

- appears in **no** `VENDOR_REQUIREMENT_MAP` entry, so no document type can
  grant it — and `deriveAllowedDocumentTypes` will not even let the classifier
  emit a type for it;
- is served only by `api_check_evidence`, which `recompute.ts` **reads** and
  nothing in the repo ever **writes**.

Any profile that requires it produces a vendor who can never activate on their
own — only an officer manual grant or waiver clears it. Nothing requires it
today, so this is a live configuration trap rather than a live bug; the check
turns it into a compile-time-style error, and clears itself the moment the
api-check writer lands (`test_unsatisfiable_category_clears_when_api_check_implemented`).

---

## 4. Ranked candidates

Spiked candidates are marked ✅; the rest are assessed, not built.

| # | Candidate | Value | Effort | Verdict |
|---|---|---|---|---|
| C1 | Activation-gate state-space model | **high** — found a confirmed order-dependence | low (184 lines) | ✅ built, `policy/gate.rego` |
| C2 | Coverage-payload `deny` set | **high** — found 5 accepted contract violations | low (156 lines) | ✅ built, `policy/coverage.rego` |
| C3 | Profile / requirement-map satisfiability | **high** — found an unsatisfiable category, cheap to keep green | low (171 lines) | ✅ built, `policy/profiles.rego` |
| C4 | Repo hard-rule checks over `docker-compose.yml`, the `package.json` files, `SANDBOX_EGRESS_ALLOWLIST`, per-lane `activeTools`, `auth.ts` | high, day-to-day | low (171 lines) | ✅ built, `policy/repo.rego` — 19 rules, each with a positive control |
| C9 | Pin the built-in surface with a generated capabilities file | medium — makes rule 1 unbreakable in the policy layer | trivial | ✅ built, `policy/capabilities-pinned.json` |
| C5 | Validators differential oracle over `validators.ts` | medium-high — would find rules that can never fire and informational/blocking misclassifications | **high** (1,132 lines to mirror) | worthwhile only slice-by-slice, starting with ACORD-25 |
| C6 | Traceability single-authority model check | medium — the invariant is stated in prose in `traceability.ts` and is exactly the shape C1 proved tractable | medium | good follow-up to C1 |
| C7 | Guard-matrix model check (role × resource × ownership → allow/401/404) | low-medium — the surface is small and already correct; value is a spec with teeth for §6.4, incl. slug-independence | low | optional |
| C8 | `opa eval --explain full` traces as worked spec examples | low | low | nice-to-have |

---

## 5. Anti-candidates

Recording these matters as much as the recommendations — each is a path the
skill's own samples would otherwise lead into:

- **Partial evaluation to SQL** (the Compile API's headline feature) — rule 7.
  Also carries the trap that `{"result":{"query":""}}` means *no filter, return
  everything* while `{}` means *deny all*, so `res.result?.query ?? ""` is an
  authorization-bypass generator.
- **Bundle service / discovery / decision logs / status API / OCP** — rule 1,
  all outbound.
- **Gatekeeper, Envoy** — no k8s, no mesh.
- **OPA at the harness tool boundary** — rules 2 and 5.
- **A runtime policy engine replacing `packages/workflow/src/vendor/`** — not on
  the table, and the findings above argue against it anyway: the value delivered
  here came from *interrogating* the engines, which requires no runtime change
  and keeps a single implementation authoritative.

---

## 6. Cost and friction, honestly

856 lines of Rego for three checks, plus 138 lines of copied fixtures and a runner. The state-space suite runs in
~30 s; the other two are instant. Three traps cost real time and are worth
knowing before anyone repeats this:

- A **package path that shadows a data key** is a compile error, not a
  shadowing warning: `package vendra.profiles` reading `data.vendra.profiles`
  fails with `rego_recursion_error` across every rule at once.
- **`opa test` has a 5 s per-test default timeout.** A 16k-scenario suite
  reports `eval_cancel_error: context deadline exceeded` on every test, which
  reads exactly like a broken policy. `--timeout 300s`.
- **The mirror is a second implementation, and can be wrong.** The
  lowered-cap test caught `honoured_options` hardcoding pairs, so the model only
  agreed with the engine at `maxManualDismissable: 2`. Every violation rule here
  therefore has a positive-control test proving it can fire — silent-undefined
  means "no violations" and "policy never ran" look identical.

The fixtures are **copies** of TS constants (seeded profiles, the requirement
map, thresholds). They go stale silently. That is the standing maintenance cost
of this approach, and the reason C4 — checks over files that *are* the source of
truth — is ranked above C5.

---

## 7. Second pass — the findings closed, and what closed them

The first pass reported F1–F3 without touching `packages/workflow`. They are now
fixed as **SPEC §18 D1/D2**, and the proof is the pass-one Rego, re-run against
the changed engines rather than re-argued.

### F1 — closed

`calculateActivationGate` now orders the honoured dismissals off the profile
(unsatisfied categories first, then `dismissible` order) instead of off `Set`
insertion order. Re-running the differential over the same 96 scenarios:

```
scenarios tested:                   96
activation flips on array order:     0   (was 96)
cap wasted on a satisfied category:  0   (was the mechanism)
```

`policy/gate.rego` gained three invariants (`cap_wasted`, `d1_size`,
`d1_scope`) that assert the new tie-break across all 16,384 states.
`order_sensitive` deliberately still reports **96** — it measures what the
*profile* leaves open, which is a property of the config, not a defect. What
changed is that a stated rule resolves it instead of a column's array order.

### F2 — closed, and one gate had to be relaxed to stay solvable

All five payloads the host used to accept are now rejected with a corrective
reason, and the clean payload still passes. But writing the aggregate gate
surfaced a bug **in the fix**: a GL line whose per-occurrence limit clears while
its aggregate falls short had *no legal verdict at all* — `MEETS` failed the new
aggregate gate, `BELOW` failed the §16 B12 relation, `UNDETERMINED` failed the
new sufficiency gate. The agent would have burned three attempts on an
unsatisfiable contract.

That is now an asserted property rather than an argument — and, since the audit
pass, a STANDING one: `policy/verify-engine-invariants.ts` re-enumerates every
coherent (occurrence, aggregate) shape on each run of `run-checks.sh`. It had to
become standing because the original proof lived in an ephemeral script that rule
3 required deleting, which left the spec asserting something nothing checked.

```
coherent shapes tested:        75
shapes with no legal verdict:   0
```

A second regression came from the same edit. Adding the aggregate exemption
turned §16 B12's disjunction into a conjunction, which silently **re-opened the
B12 bug** — the `999,999 / BELOW` payload started passing again. The pass-one
payload set caught it on the next run. The exemption now sits on top of the
disjunction rather than inside it.

Both bugs were mine, both were introduced while fixing something else, and both
were caught by re-running an existing suite. That is the argument for keeping
the mirrors around, more than for having written them.

### C4 — the eight prose rules, executable

`policy/repo.rego` checks 19 invariants drawn from `.claude/CLAUDE.md`: the
egress allowlist and its wiring, forbidden dependencies, the foreign-database
port and hosted-DB hosts, per-lane `activeTools`/`permissionMode`/`abortSignal`,
committed test files, a second `pg` client, `sql.raw`, the disabled sign-up
endpoint, and auth rate limiting. The repo is clean on all 14; each rule has a
positive control proving it fires.

The design choice that matters: `extract-repo-facts.py` regenerates the facts
from the **real files on every run**, so this check cannot pass against a stale
copy the way `policy/data/*.json` can. It also produced the pass's cheapest
lesson — the rule-7 check first flagged `auth.ts` for `"pg"`, which is
`provider: "pg"`, the Drizzle *dialect name*. A rule that over-matches trains
you to ignore its output, so the extractor matches imports only.

### C9 — rule 1, enforced on the tool

`policy/capabilities-pinned.json` is `opa capabilities --current` minus
`http.send`, `net.lookup_ip_addr` and `opa.runtime`. Every `opa check`/`opa test`
in the runner passes it, so a policy that reaches the network fails to compile:

```
$ opa check --capabilities policy/capabilities-pinned.json probe-egress.rego
rego_type_error: undefined function http.send
```

The runner also gained `--threshold` coverage floors and `-m 0`, both from the
skill audit — `opa check` silently truncates at 10 errors, which had already
skewed one measurement during that audit.

### The stricter gates against a real agent run

Synthetic proofs do not tell you whether a real model can satisfy the contract.
`COVERAGE_DETERMINATION_VERSION 1 → 2` invalidated every persisted
determination, so an officer kick re-ran the lane for a live vendor:

| | signature | version | GL | AUTO | WC |
|---|---|---|---|---|---|
| before | `v1-63460a13` | 1 | — | — | — |
| after | `v2-f90ab60a` | 2 | MEETS 1,000,000 / 2,000,000 | MEETS 1,000,000 / null | MEETS 500,000 / 500,000 |

The payload cleared all five new gates on the first attempt — no bounce. Note
the two shapes that would have failed a naive implementation: GL's aggregate is
*exactly* the required 2,000,000 (the gate is `>=`, not `>`), and AUTO reports a
null aggregate, which stays legal because only a *reported* aggregate is
bounded. Forcing every line to carry one would have broken this run.

### Still open, deliberately

`validateCoverageDetermination` re-derives the payload's *internal* consistency
but never receives the extracted per-document limits, so no gate can anchor
`amountAppliedUsd` to what a document actually said. Closing that means
threading extraction data into validation — a signature and data-flow change,
and its own reviewed round.

## 8. The adoption that happened, and its boundary

SPEC §19 needed one decision made by policy rather than code: **is a proposed
per-company document policy admissible?** That question is asked when a company
activates a policy — a handful of times per company, ever — and answering it
needs the document/validator/category catalogs, satisfiability over a config
space, and every violation at once rather than the first. That is Rego's shape,
not TypeScript's.

So `policy/company-policy.rego` (10 rejection rules, 2 warnings, 16 assertions)
compiles to a committed `company-policy.wasm`, and
`apps/vendra/src/server/policy-admission.ts` evaluates it in-process. The
boundary that keeps this narrow:

- **Activation only.** The request path is untouched — no OPA in document
  processing, validation, the fold, or the gate.
- **Facts, not fixtures.** The catalogs handed to Rego are generated from the
  real engines on every call, so the gate cannot pass against a stale copy the
  way `policy/data/*.json` can.
- **No egress, no server, no subprocess.** One npm package, one committed
  artifact. The module needs exactly one host built-in (`sprintf`), which the
  SDK's six include — checked by `repo.rego`, along with the entrypoint matching
  the string the app calls and the artifact matching its source by content hash.
- **The deterministic engines stay the single implementation.** §5's
  anti-candidate — a policy engine on the request path — is unchanged.

What made this safe to adopt was not the Rego; it was that the assessment in §1–§7
had already been run dev-time first. The mirrors caught the two bugs the fixes
introduced, and the audit pass caught a third that no amount of review had:
the referee gate sitting on a path that could not enforce it.

## 9. Questions adoption had to answer (answered)

Not proposed here. The questions it would have to answer first:

1. What would a runtime engine do that the TS engines do not? "Configurable" is
   already answered by profile rows.
2. Two implementations of the adjudication core, or a migration? Two means
   permanent drift risk; a migration means the audit trail, the Spanish refusal
   copy, and `ValidationRule[]` shapes all have to come out of Rego.
3. Sidecar or Wasm? A compose sidecar adds a service and a network hop this repo
   would own; in-process Wasm adds a build step and the 6-built-in limit.
4. Decision logging is where an audited compliance product would most want OPA —
   and OPA's decision-log *shipper* is out of bounds (rule 1), so the log would
   have to land in this app's own Postgres through host code.

---

## 10. Third pass — the audit that followed

§19 shipped with green gates. A six-dimension audit with adversarial
verification of every finding then found that green gates were not correctness:
one **blocking** defect, ten serious, and a long tail. The full record is SPEC
§20; the two worth repeating here because they are lessons about the method, not
about vendra:

**A gate is only a gate if it sits where the decision is made.** The referee
boundary was applied at the document persist site. For the three coverage
categories that site grants nothing — the determination fold does — so the
setting withheld nothing while still opening an officer referral. The queue said
"awaiting decision" for a category the pipeline granted anyway. The fix moved the
gate into `addSource`, the single choke point every grant passes through. Finding
it needed a trace of both grant channels, which no test asserted and no reviewer
had reason to walk.

**Keeping the evidence visible almost defeated the fix.** The first version left
the withheld source in `CategoryEvidence.sources` so an officer could see it. But
the activation gate is derived from `sources.length` — so the withheld evidence
would have cleared the very gate the referral exists to hold. Withheld sources
now live in their own array. Two lines, and the difference between a governance
feature and a decoration.

Both of those are the same shape as the earlier findings: a claim that was true
of one code path and assumed of all of them.
