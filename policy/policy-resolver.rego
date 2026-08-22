# METADATA
# title: Referee-boundary model (SPEC §19.4)
# description: |
#   An order-independent mirror of the single referee predicate,
#   `isGrantWithheldByPolicy` in packages/workflow/src/vendor/policy.ts —
#   applied by `deriveRequirementEvidence` (traceability.ts), which only binds
#   the required/refereeable sets (SPEC §23.13) — plus the flag-exclusivity
#   fixup, enumerated over the whole state space: category required or not ×
#   refereeable or not × the five grant source kinds.
#
#   This suite exists because of a specific defect. The first implementation had
#   the DIRECTION of `refereeable_categories` backwards — it read the list as
#   "categories the pipeline may newly settle" instead of "categories where the
#   pipeline keeps settling". With the behaviour-preserving default (an empty
#   list) that inversion refers EVERY category and grants nothing, which the
#   invariants below make impossible to ship silently.
package vendra.checks.resolver

import rego.v1

# The five kinds a grant source can have (`GrantSource.kind`).
source_kinds := ["document", "determination", "api_check", "manual_grant", "waiver"]

# An OFFICER's own decision. Withholding these would make the rescue path
# unreachable: the human could never ratify anything.
officer_kinds := {"manual_grant", "waiver"}

scenarios contains s if {
	some required in [true, false]
	some refereeable in [true, false]
	some kind in source_kinds
	s := {"required": required, "refereeable": refereeable, "kind": kind}
}

# Which READING of `refereeable_categories` is in force. "keeps" is the shipped,
# correct one: the list names the categories where the automated pipeline KEEPS
# settling. "grants" is the inverted reading that was implemented first and had
# to be fixed — it is selectable here purely so the tests can prove these
# invariants catch it (see policy-resolver_test.rego).
# A `default` rule, not object.get(input, ...): with no input at all — which is
# the normal case for `opa test` and `opa eval` — indexing input is UNDEFINED, and
# an undefined `direction` would make `withheld` undefined and quietly invert
# every invariant below. Silent undefined, exactly as the skill warns.
default direction := "keeps"

direction := d if {
	d := input.direction
	d in {"keeps", "grants"}
}

# The mirror of `isGrantWithheldByPolicy` (policy.ts, via traceability.ts).
withheld(s) if {
	not s.kind in officer_kinds
	s.required
	direction == "keeps"
	not s.refereeable
}

withheld(s) if {
	not s.kind in officer_kinds
	s.required
	direction == "grants"
	s.refereeable
}

# --- the invariants ----------------------------------------------------------

# 1. An officer source is NEVER withheld.
violation contains v if {
	some s in scenarios
	s.kind in officer_kinds
	withheld(s)
	v := {"rule": "officer_source_withheld", "scenario": s}
}

# 2. A category no profile requires is never withheld — referring it would ask a
#    question whose answer cannot change activation.
violation contains v if {
	some s in scenarios
	not s.required
	withheld(s)
	v := {"rule": "non_required_withheld", "scenario": s}
}

# 3. A refereeable category is never withheld. This is the invariant the
#    inversion violated: with everything refereeable (the default) nothing may be
#    held back.
violation contains v if {
	some s in scenarios
	s.refereeable
	withheld(s)
	v := {"rule": "refereeable_withheld", "scenario": s}
}

# 4. The boundary must actually BITE: an automated source proving a required,
#    non-refereeable category has to be withheld, or the feature does nothing.
violation contains v if {
	some s in scenarios
	not s.kind in officer_kinds
	s.required
	not s.refereeable
	not withheld(s)
	v := {"rule": "boundary_does_not_bite", "scenario": s}
}

# --- flag exclusivity (the fold's post-pass) ---------------------------------

# `granted` wins over `referred` (an officer may have ratified); `referred` wins
# over `determining`. The bug this replaced rendered a coverage category as green
# AND pending at once.
flag_states contains f if {
	some granted in [true, false]
	some referred in [true, false]
	some determining in [true, false]
	f := {"granted": granted, "referred": referred, "determining": determining}
}

# granted wins over referred; referred wins over determining.
default resolved_referred(_) := false

resolved_referred(f) if {
	f.referred
	not f.granted
}

default resolved_determining(_) := false

resolved_determining(f) if {
	f.determining
	not f.granted
	not resolved_referred(f)
}

violation contains v if {
	some f in flag_states
	f.granted
	resolved_referred(f)
	v := {"rule": "granted_and_referred", "flags": f}
}

violation contains v if {
	some f in flag_states
	resolved_referred(f)
	resolved_determining(f)
	v := {"rule": "referred_and_determining", "flags": f}
}

summary := {
	"scenarios": count(scenarios),
	"flag_states": count(flag_states),
	"violations": count(violation),
}
