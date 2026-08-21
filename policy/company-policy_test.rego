package vendra.policy.admission_test

import data.vendra.policy.admission
import rego.v1

# A minimal ADMISSIBLE configuration. Each test patches exactly one thing, so a
# rule that fires proves it fires for its own reason.
base := {
	"policy": {
		"refereeable_categories": ["TAX_IDENTITY"],
		"documents": [{
			"document_type": "W9",
			"extract_fields": ["legal_name", "tin_last4"],
			"validators": ["entity_name_match", "is_signed"],
		}],
	},
	"superset": {
		"categories": ["TAX_IDENTITY", "SAFETY_RECORD"],
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
	"thresholds": {"emrMax": 1, "soc2MaxAgeMonths": 12},
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
