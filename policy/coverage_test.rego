package vendra.checks.coverage_test

import data.vendra.checks.coverage

thresholds := {
	"glOccurrenceUsd": 1000000, "glAggregateUsd": 2000000,
	"autoLimitUsd": 1000000, "wcLimitUsd": 500000, "cyberLimitUsd": 1000000,
	"emrMax": 1, "soc2MaxAgeMonths": 12, "requireAdditionalInsured": true,
	"requireWaiverOfSubrogation": false, "requirePrimaryNoncontributory": false,
}

req(lines) := {
	"payload": {"lines": lines, "conflicts": [], "narrative": "n"},
	"allowed_document_uuids": ["doc-a", "doc-b"],
	"thresholds": thresholds,
}

line(patch) := object.union(
	{
		"category": "GENERAL_LIABILITY",
		"effectiveOccurrenceLimitUsd": 1000000,
		"effectiveAggregateLimitUsd": 2000000,
		"verdict": "MEETS",
		"reasoning": "r",
		"contributions": [{
			"documentUuid": "doc-a", "role": "primary",
			"amountAppliedUsd": 1000000, "reasoning": "r",
		}],
	},
	patch,
)

fires(rule_set, prefix) if {
	some m in rule_set
	startswith(m, prefix)
}

# --- baseline ----------------------------------------------------------------

test_clean_payload_is_accepted if {
	count(coverage.deny) == 0 with input as req([line({})])
}

# --- what the host enforces (each control proves the mirror can fire) --------

test_duplicate_line if {
	fires(coverage.deny, "duplicate_line") with input as req([line({}), line({"reasoning": "r2"})])
}

test_uuid_not_in_input_set if {
	fires(coverage.deny, "uuid_not_in_input_set") with input as req([line({"contributions": [{
		"documentUuid": "doc-ghost", "role": "primary",
		"amountAppliedUsd": 1000000, "reasoning": "r",
	}]})])
}

test_rejected_contribution_pays if {
	fires(coverage.deny, "rejected_contribution_pays") with input as req([line({"contributions": [
		{"documentUuid": "doc-a", "role": "primary", "amountAppliedUsd": 1000000, "reasoning": "r"},
		{"documentUuid": "doc-b", "role": "rejected", "amountAppliedUsd": 500000, "reasoning": "r"},
	]})])
}

test_meets_with_null_limit if {
	fires(coverage.deny, "meets_with_null_limit") with input as req([line({
		"effectiveOccurrenceLimitUsd": null, "contributions": [],
	})])
}

test_effective_limit_without_contributions if {
	fires(coverage.deny, "effective_limit_without_contributions") with input as req([line({
		"verdict": "UNDETERMINED", "contributions": [],
	})])
}

test_drift_over_1pct if {
	fires(coverage.deny, "drift_over_1pct") with input as req([line({
		"effectiveOccurrenceLimitUsd": 2000000,
	})])
}

test_meets_below_required if {
	fires(coverage.deny, "meets_below_required") with input as req([line({
		"category": "WORKERS_COMP",
		"effectiveOccurrenceLimitUsd": 400000,
		"effectiveAggregateLimitUsd": null,
		"contributions": [{
			"documentUuid": "doc-a", "role": "primary",
			"amountAppliedUsd": 400000, "reasoning": "r",
		}],
	})])
}

# The §16 B12 shape: claimed 999,999 / BELOW with contributions summing to the
# required limit.
test_below_at_or_above_required if {
	fires(coverage.deny, "below_at_or_above_required") with input as req([line({
		"verdict": "BELOW", "effectiveOccurrenceLimitUsd": 999999,
	})])
}

# --- adopted as SPEC §18 D2: every one of these is now REJECTED -------------

test_below_with_null_limit_is_denied if {
	fires(coverage.deny, "below_with_null_limit") with input as req([line({
		"verdict": "BELOW", "effectiveOccurrenceLimitUsd": null,
		"effectiveAggregateLimitUsd": null, "contributions": [],
	})])
}

# UNDETERMINED + null stays legal — that is the whole point of the verdict.
test_undetermined_with_null_limit_is_allowed if {
	count(coverage.deny) == 0 with input as req([line({
		"verdict": "UNDETERMINED", "effectiveOccurrenceLimitUsd": null,
		"effectiveAggregateLimitUsd": null, "contributions": [],
	})])
}

test_negative_contribution_is_denied if {
	payload := req([line({"contributions": [
		{"documentUuid": "doc-a", "role": "primary", "amountAppliedUsd": 2000000, "reasoning": "r"},
		{"documentUuid": "doc-b", "role": "excess", "amountAppliedUsd": -1000000, "reasoning": "netting"},
	]})])
	fires(coverage.deny, "negative_contribution") with input as payload
}

test_empty_determination_is_denied if {
	fires(coverage.deny, "empty_determination_accepted_as_fresh") with input as req([])
}

test_aggregate_below_occurrence_is_denied if {
	payload := req([line({"effectiveAggregateLimitUsd": 1})])
	fires(coverage.deny, "aggregate_below_occurrence") with input as payload
	fires(coverage.deny, "gl_aggregate_below_threshold") with input as payload
}

# A GL MEETS whose aggregate clears occurrence but not the profile's aggregate
# threshold is denied on the threshold rule alone.
test_gl_aggregate_below_threshold_alone_is_denied if {
	payload := req([line({"effectiveAggregateLimitUsd": 1500000})])
	fires(coverage.deny, "gl_aggregate_below_threshold") with input as payload
	not fires(coverage.deny, "aggregate_below_occurrence") with input as payload
}

# ...and the same shape reported as BELOW is LEGAL — the aggregate shortfall is
# the reason. Without this exemption the payload would have no legal verdict:
# MEETS trips the aggregate gate, BELOW tripped §16 B12, UNDETERMINED trips the
# sufficiency gate.
test_gl_aggregate_shortfall_makes_below_legal if {
	count(coverage.deny) == 0 with input as req([line({
		"verdict": "BELOW", "effectiveAggregateLimitUsd": 1000000,
	})])
}

# The B12 disjunction survives the exemption: no aggregate reported means no
# exemption, so a BELOW at/above the required occurrence is still denied.
test_b12_survives_the_aggregate_exemption if {
	fires(coverage.deny, "below_at_or_above_required") with input as req([line({
		"verdict": "BELOW", "effectiveOccurrenceLimitUsd": 999999,
		"effectiveAggregateLimitUsd": null,
	})])
}

test_undetermined_despite_sufficient_limit_is_denied if {
	payload := req([line({
		"verdict": "UNDETERMINED",
		"effectiveOccurrenceLimitUsd": 5000000,
		"effectiveAggregateLimitUsd": 5000000,
		"contributions": [{
			"documentUuid": "doc-a", "role": "primary",
			"amountAppliedUsd": 5000000, "reasoning": "r",
		}],
	})])
	fires(coverage.deny, "undetermined_despite_sufficient_limit") with input as payload
}

# --- the curated case table (policy/data/coverage-cases.json, SPEC §23.12) ----

# The data file is passed by run-checks.sh; if it stops being passed, the
# `every` below goes undefined and the test FAILS rather than passing on
# nothing. The count pins the table so a truncated file cannot pass either.

test_data_case_table_is_loaded if {
	count(data.coverage_cases.cases) >= 13
}

test_data_cases_match_expectations if {
	every case in data.coverage_cases.cases {
		got := {prefix |
			some msg in coverage.deny
			prefix := split(msg, ":")[0]
		} with input as {
			"payload": {"lines": case.lines, "conflicts": [], "narrative": "n"},
			"thresholds": data.coverage_cases.thresholds,
			"allowed_document_uuids": data.coverage_cases.allowed,
		}
		got == {e | some e in case.expect}
	}
}
