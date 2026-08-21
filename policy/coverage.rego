# METADATA
# title: Coverage-determination payload adjudication
# description: |
#   `deny` mirrors what validateCoverageDetermination() enforces, as a partial
#   set (the TS returns only the FIRST failure, so this reports all of them).
#
#   The five rules that used to live in a separate `gap` set — payloads the
#   contract stated but the host accepted — were adopted as SPEC §18 D2 and are
#   now enforced, so they moved into `deny`.
#
#   Still unenforced, and NOT expressible here: contributions are never anchored
#   to the extracted per-document limits, because validateCoverageDetermination
#   does not receive them. The arithmetic is only ever checked against itself.
package vendra.checks.coverage

payload := input.payload

thresholds := input.thresholds

allowed_uuids := {u | some u in input.allowed_document_uuids}

required_limit("GENERAL_LIABILITY") := thresholds.glOccurrenceUsd

required_limit("WORKERS_COMP") := thresholds.wcLimitUsd

required_limit("AUTO") := thresholds.autoLimitUsd

# Sum of the non-rejected contributions — what assembly persists as the
# effective limit (spec §16 B12).
persisted(line) := sum([c.amountAppliedUsd |
	some c in line.contributions
	c.role != "rejected"
])

# SPEC §18 D2: a GL aggregate below the profile's requirement is a legitimate
# reason for BELOW even when the per-occurrence figure clears. Without this
# exemption the shape would have no legal verdict at all.
aggregate_short(line) if {
	line.category == "GENERAL_LIABILITY"
	line.effectiveAggregateLimitUsd != null
	line.effectiveAggregateLimitUsd < thresholds.glAggregateUsd
}

# --- what the host enforces today --------------------------------------------

deny contains msg if {
	some category, n in {cat: c |
		some cat in {l.category | some l in payload.lines}
		c := count([l | some l in payload.lines; l.category == cat])
	}
	n > 1
	msg := sprintf("duplicate_line: %v reported %v times", [category, n])
}

deny contains msg if {
	some line in payload.lines
	some c in line.contributions
	not c.documentUuid in allowed_uuids
	msg := sprintf("uuid_not_in_input_set: %v", [c.documentUuid])
}

deny contains msg if {
	some line in payload.lines
	some c in line.contributions
	c.role == "rejected"
	c.amountAppliedUsd > 0
	msg := sprintf("rejected_contribution_pays: %v on %v", [c.amountAppliedUsd, c.documentUuid])
}

deny contains msg if {
	some line in payload.lines
	line.verdict == "MEETS"
	line.effectiveOccurrenceLimitUsd == null
	msg := sprintf("meets_with_null_limit: %v", [line.category])
}

deny contains msg if {
	some line in payload.lines
	line.effectiveOccurrenceLimitUsd != null
	persisted(line) == 0
	line.effectiveOccurrenceLimitUsd > 0
	msg := sprintf("effective_limit_without_contributions: %v", [line.category])
}

deny contains msg if {
	some line in payload.lines
	line.effectiveOccurrenceLimitUsd != null
	persisted(line) != 0
	drift := abs(persisted(line) - line.effectiveOccurrenceLimitUsd) / max([line.effectiveOccurrenceLimitUsd, 1])
	drift > 0.01
	msg := sprintf("drift_over_1pct: %v claims %v, contributions sum %v", [line.category, line.effectiveOccurrenceLimitUsd, persisted(line)])
}

deny contains msg if {
	some line in payload.lines
	line.effectiveOccurrenceLimitUsd != null
	line.verdict == "MEETS"
	min([line.effectiveOccurrenceLimitUsd, persisted(line)]) < required_limit(line.category)
	msg := sprintf("meets_below_required: %v", [line.category])
}

deny contains msg if {
	some line in payload.lines
	line.effectiveOccurrenceLimitUsd != null
	line.verdict == "BELOW"
	max([line.effectiveOccurrenceLimitUsd, persisted(line)]) >= required_limit(line.category)
	not aggregate_short(line)
	msg := sprintf("below_at_or_above_required: %v", [line.category])
}

# --- adopted as SPEC §18 D2 (were accepted before that round) ---------------

# The refusal copy always said "null is only legal with verdict UNDETERMINED";
# before D2 only MEETS was checked, so BELOW + null persisted.
deny contains msg if {
	some line in payload.lines
	line.effectiveOccurrenceLimitUsd == null
	line.verdict == "BELOW"
	msg := sprintf("below_with_null_limit: %v (contract says null is UNDETERMINED-only)", [line.category])
}

# Nothing bounded amountAppliedUsd from below, so offsetting contributions
# satisfied the +-1%% re-derivation with invented arithmetic.
deny contains msg if {
	some line in payload.lines
	some c in line.contributions
	c.amountAppliedUsd < 0
	msg := sprintf("negative_contribution: %v on %v", [c.amountAppliedUsd, c.documentUuid])
}

# An empty payload passed every check, then persisted as a FRESH determination
# for the current signature: no line was ever granted and the lane would not
# re-run until an input changed.
deny contains msg if {
	count(payload.lines) == 0
	msg := "empty_determination_accepted_as_fresh"
}

# effectiveAggregateLimitUsd was never validated: not re-derived, not compared
# to glAggregateUsd, not required to exceed the per-occurrence figure. It is
# bounded rather than re-derived — contributions attribute per occurrence.
deny contains msg if {
	some line in payload.lines
	line.effectiveAggregateLimitUsd != null
	line.effectiveOccurrenceLimitUsd != null
	line.effectiveAggregateLimitUsd < line.effectiveOccurrenceLimitUsd
	msg := sprintf("aggregate_below_occurrence: %v", [line.category])
}

deny contains msg if {
	some line in payload.lines
	line.verdict == "MEETS"
	aggregate_short(line)
	msg := sprintf("gl_aggregate_below_threshold: %v < %v", [line.effectiveAggregateLimitUsd, thresholds.glAggregateUsd])
}

# UNDETERMINED while the evidence resolves at or above the requirement is a
# false negative: the vendor stays blocked on coverage it demonstrably has.
deny contains msg if {
	some line in payload.lines
	line.verdict == "UNDETERMINED"
	line.effectiveOccurrenceLimitUsd != null
	line.effectiveOccurrenceLimitUsd >= required_limit(line.category)
	msg := sprintf("undetermined_despite_sufficient_limit: %v", [line.category])
}

decision := {"host_denies": deny}
