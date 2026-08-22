package vendra.policy.admission_test

import data.vendra.policy.admission
import rego.v1

# A minimal ADMISSIBLE configuration. Each test patches exactly one thing, so a
# rule that fires proves it fires for its own reason.
base := {
	"policy": {
		"refereeable_categories": ["TAX_IDENTITY"],
		"assistant_privilege": "CONVERSATIONAL",
		"documents": [{
			"document_type": "W9",
			"extract_fields": ["legal_name", "tin_last4"],
			"validators": ["entity_name_match", "is_signed"],
		}],
	},
	"company": {"officer_count": 1},
	"superset": {
		"categories": ["TAX_IDENTITY", "SAFETY_RECORD"],
		"assistant_privileges": ["CONVERSATIONAL", "EMPOWERED"],
		"document_types": {
			"W9": {
				"fields": ["legal_name", "tin_last4", "dba_name"],
				"structural_fields": ["legal_name", "tin_last4"],
				"validators": ["entity_name_match", "is_signed", "tin_present_and_masked"],
				"categories": ["TAX_IDENTITY"],
			},
			"EMR_LETTER": {
				"fields": ["business_name", "emr_rate"],
				"structural_fields": ["business_name"],
				"validators": ["entity_name_match", "emr_within_bound"],
				"categories": ["SAFETY_RECORD"],
			},
		},
	},
	"profiles": [{"required": ["TAX_IDENTITY"], "mandatory": ["TAX_IDENTITY"]}],
	"thresholds": {
		"emrMax": 1,
		"soc2MaxAgeMonths": 12,
		"glOccurrenceUsd": 1000000,
		"glAggregateUsd": 2000000,
		"autoLimitUsd": 1000000,
		"wcLimitUsd": 500000,
		"cyberLimitUsd": 1000000,
	},
}

rules(vs) := {v.rule | some v in vs}

patched(p) := object.union(base, p)

test_base_is_admissible if {
	admission.decision.admissible with input as base
	count(admission.violation) == 0 with input as base
}

# --- document set ------------------------------------------------------------

test_unknown_document_type_fires if {
	got := rules(admission.violation) with input as patched({"policy": {"documents": [{
		"document_type": "NOT_A_TYPE",
		"extract_fields": [],
		"validators": ["entity_name_match"],
	}]}})
	"unknown_document_type" in got
}

test_no_documents_fires if {
	got := rules(admission.violation) with input as patched({"policy": {"documents": []}})
	"no_documents_accepted" in got
}

# --- the load-bearing one ----------------------------------------------------

test_document_without_validators_fires if {
	got := rules(admission.violation) with input as patched({"policy": {"documents": [{
		"document_type": "W9",
		"extract_fields": ["legal_name", "tin_last4"],
		"validators": [],
	}]}})
	"document_without_validators" in got
}

test_validator_not_applicable_fires if {
	got := rules(admission.violation) with input as patched({"policy": {"documents": [{
		"document_type": "W9",
		"extract_fields": ["legal_name", "tin_last4"],
		"validators": ["entity_name_match", "emr_within_bound"],
	}]}})
	"validator_not_applicable" in got
}

# --- fields ------------------------------------------------------------------

test_unknown_field_fires if {
	got := rules(admission.violation) with input as patched({"policy": {"documents": [{
		"document_type": "W9",
		"extract_fields": ["legal_name", "tin_last4", "not_a_field"],
		"validators": ["entity_name_match"],
	}]}})
	"unknown_field" in got
}

test_structural_field_deselected_fires if {
	got := rules(admission.violation) with input as patched({"policy": {"documents": [{
		"document_type": "W9",
		"extract_fields": ["legal_name"],
		"validators": ["entity_name_match"],
	}]}})
	"structural_field_deselected" in got
}

# An EMPTY field list means "every field", so it must NOT trip the structural
# rule — that is the behaviour-preserving default (§19.6).
test_empty_field_list_is_not_a_deselection if {
	got := rules(admission.violation) with input as patched({"policy": {"documents": [{
		"document_type": "W9",
		"extract_fields": [],
		"validators": ["entity_name_match"],
	}]}})
	not "structural_field_deselected" in got
}

# --- satisfiability ----------------------------------------------------------

test_required_category_ungrantable_fires if {
	got := rules(admission.violation) with input as patched({"profiles": [{
		"required": ["TAX_IDENTITY", "SAFETY_RECORD"],
		"mandatory": [],
	}]})
	"required_category_ungrantable" in got
}

test_accepting_the_granting_type_clears_it if {
	got := rules(admission.violation) with input as patched({
		"profiles": [{"required": ["TAX_IDENTITY", "SAFETY_RECORD"], "mandatory": []}],
		"policy": {"documents": [
			{
				"document_type": "W9", "extract_fields": [],
				"validators": ["entity_name_match"],
			},
			{
				"document_type": "EMR_LETTER", "extract_fields": [],
				"validators": ["emr_within_bound"],
			},
		]},
	})
	not "required_category_ungrantable" in got
}

# --- referee boundary --------------------------------------------------------

test_refereeable_not_required_fires if {
	got := rules(admission.violation) with input as patched({"policy": {
		"refereeable_categories": ["TAX_IDENTITY", "SAFETY_RECORD"],
	}})
	"refereeable_not_required" in got
}

test_unknown_category_fires if {
	got := rules(admission.violation) with input as patched({
		"policy": {"refereeable_categories": ["NOT_A_CATEGORY"]},
		"profiles": [{"required": ["TAX_IDENTITY", "NOT_A_CATEGORY"], "mandatory": []}],
	})
	"unknown_category" in got
}

# --- warnings (never block) --------------------------------------------------

test_mandatory_referred_warns_without_blocking if {
	patch := patched({"policy": {"refereeable_categories": []}})
	warned := {w.rule | some w in admission.warning} with input as patch
	"mandatory_category_referred" in warned
	admission.decision.admissible with input as patch
}

test_reduced_validators_warns_without_blocking if {
	warned := {w.rule | some w in admission.warning} with input as base
	"validators_reduced" in warned
	admission.decision.admissible with input as base
}

# --- threshold coherence -----------------------------------------------------

test_zero_threshold_makes_validator_unsatisfiable if {
	got := rules(admission.violation) with input as patched({
		"policy": {"documents": [{
			"document_type": "EMR_LETTER", "extract_fields": [],
			"validators": ["emr_within_bound"],
		}]},
		"profiles": [{"required": ["SAFETY_RECORD"], "mandatory": []}],
		"thresholds": {"emrMax": 0, "soc2MaxAgeMonths": 12},
	})
	"threshold_makes_validator_unsatisfiable" in got
}

test_positive_threshold_is_fine if {
	got := rules(admission.violation) with input as patched({
		"policy": {"documents": [{
			"document_type": "EMR_LETTER", "extract_fields": [],
			"validators": ["emr_within_bound"],
		}]},
		"profiles": [{"required": ["SAFETY_RECORD"], "mandatory": []}],
	})
	not "threshold_makes_validator_unsatisfiable" in got
}

# A MISSING key must fire the same rule, not silently undefine it — the
# object.get(-1) default exists for exactly this test (SPEC §23.5).
test_missing_emr_threshold_fires if {
	got := rules(admission.violation) with input as json.remove(
		patched({
			"policy": {"documents": [{
				"document_type": "EMR_LETTER", "extract_fields": [],
				"validators": ["emr_within_bound"],
			}]},
			"profiles": [{"required": ["SAFETY_RECORD"], "mandatory": []}],
		}),
		["/thresholds/emrMax"],
	)
	"threshold_makes_validator_unsatisfiable" in got
}

# --- USD floor coherence (SPEC §23.5) -----------------------------------------

# base + a COI-like type running limit_meets_threshold.
coi_patch := patched({
	"superset": {
		"categories": ["TAX_IDENTITY", "SAFETY_RECORD", "GENERAL_LIABILITY"],
		"document_types": {"ACORD_25_COI": {
			"fields": ["insured_name", "gl_occurrence_limit"],
			"structural_fields": ["insured_name"],
			"validators": ["entity_name_match", "limit_meets_threshold"],
			"categories": ["GENERAL_LIABILITY"],
		}},
	},
	"policy": {"documents": [
		{
			"document_type": "W9", "extract_fields": [],
			"validators": ["entity_name_match", "is_signed", "tin_present_and_masked"],
		},
		{
			"document_type": "ACORD_25_COI", "extract_fields": [],
			"validators": ["entity_name_match", "limit_meets_threshold"],
		},
	]},
})

test_zero_gl_floor_disables_limit_check if {
	got := rules(admission.violation) with input as object.union(coi_patch, {"thresholds": {"glOccurrenceUsd": 0}})
	"threshold_disables_limit_check" in got
}

test_zero_usd_floor_without_limit_check_is_fine if {
	got := rules(admission.violation) with input as patched({"thresholds": {"glOccurrenceUsd": 0}})
	not "threshold_disables_limit_check" in got
}

test_missing_usd_key_fires_when_limit_check_selected if {
	got := rules(admission.violation) with input as json.remove(coi_patch, ["/thresholds/wcLimitUsd"])
	"threshold_disables_limit_check" in got
}

test_absent_thresholds_object_fires if {
	got := rules(admission.violation) with input as json.remove(coi_patch, ["/thresholds"])
	"threshold_disables_limit_check" in got
}

# --- assistant privilege (SPEC §24) --------------------------------------------

test_unknown_privilege_level_fires if {
	got := rules(admission.violation) with input as patched({"policy": {"assistant_privilege": "GODMODE"}})
	"unknown_privilege_level" in got
}

test_empowered_without_officer_fires if {
	got := rules(admission.violation) with input as patched({
		"policy": {"assistant_privilege": "EMPOWERED"},
		"company": {"officer_count": 0},
	})
	"empowered_requires_officer" in got
}

test_empowered_with_officer_admissible if {
	patch := patched({"policy": {"assistant_privilege": "EMPOWERED"}})
	got := rules(admission.violation) with input as patch
	not "empowered_requires_officer" in got
	admission.decision.admissible with input as patch
}

# Behaviour preservation (§24.1): a pre-§24 caller sends no privilege at all,
# and even with zero officers that must stay admissible — absent defaults to
# CONVERSATIONAL, which asks nothing of the approver pool.
test_missing_privilege_defaults_conversational if {
	legacy := json.remove(
		patched({"company": {"officer_count": 0}}),
		["/policy/assistant_privilege"],
	)
	got := rules(admission.violation) with input as legacy
	not "empowered_requires_officer" in got
	not "unknown_privilege_level" in got
}
