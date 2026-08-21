package vendra.checks.profiles_test

import data.vendra.checks.profiles

rules(vs) := {v.rule | some v in vs}

# The two seeded v1 presets are clean — the regression baseline.
test_seeded_profiles_are_clean if {
	count(profiles.violation) == 0
	count(profiles.warn) == 0
}

test_mandatory_not_required_fires if {
	got := rules(profiles.violation) with data.vendra.profiles as [{
		"name": "p", "required": ["TAX_IDENTITY"],
		"mandatory": ["BUSINESS_LICENSE"], "dismissible": [],
		"max_manual_dismissable": 0,
	}]
	got == {"mandatory_not_required"}
}

test_dismissible_not_required_fires if {
	got := rules(profiles.violation) with data.vendra.profiles as [{
		"name": "p", "required": ["TAX_IDENTITY"],
		"mandatory": [], "dismissible": ["SAFETY_RECORD"],
		"max_manual_dismissable": 1,
	}]
	got == {"dismissible_not_required"}
}

test_mandatory_is_dismissible_fires if {
	got := rules(profiles.violation) with data.vendra.profiles as [{
		"name": "p", "required": ["TAX_IDENTITY"],
		"mandatory": ["TAX_IDENTITY"], "dismissible": ["TAX_IDENTITY"],
		"max_manual_dismissable": 1,
	}]
	got == {"mandatory_is_dismissible"}
}

test_unknown_category_fires if {
	got := rules(profiles.violation) with data.vendra.profiles as [{
		"name": "p", "required": ["TAX_IDENTITY", "INSURANCE_CYBER"],
		"mandatory": [], "dismissible": [],
		"max_manual_dismissable": 0,
	}]
	got == {"unknown_category"}
}

test_empty_required_fires if {
	got := rules(profiles.violation) with data.vendra.profiles as [{
		"name": "p", "required": [],
		"mandatory": [], "dismissible": [],
		"max_manual_dismissable": 0,
	}]
	got == {"empty_required"}
}

# The live bug class: SANCTIONS_SCREENING ships in the catalog, is accepted by
# the unconstrained `required text[]` column, and nothing implemented grants it.
test_unsatisfiable_category_fires_on_sanctions_screening if {
	got := rules(profiles.violation) with data.vendra.profiles as [{
		"name": "p", "required": ["TAX_IDENTITY", "SANCTIONS_SCREENING"],
		"mandatory": [], "dismissible": [],
		"max_manual_dismissable": 0,
	}]
	got == {"unsatisfiable_category"}
}

# Turning the api-check path on clears it — the check tracks implementation.
test_unsatisfiable_category_clears_when_api_check_implemented if {
	count(profiles.violation) == 0 with data.vendra.profiles as [{
		"name": "p", "required": ["SANCTIONS_SCREENING"],
		"mandatory": [], "dismissible": [],
		"max_manual_dismissable": 0,
	}]
		with data.vendra.automated_grant_paths as {"api_check": {
			"implemented": true,
			"categories": ["SANCTIONS_SCREENING"],
		}}
}

# GUARD RULE: unreachable for every profile under the CURRENT requirement map
# (any coverage category in `required` allows ACORD_25_COI by construction).
# It exists to catch a future map that drops the insurance types, so its
# control has to mock the map itself.
test_coverage_without_insurance_type_fires_only_on_a_broken_map if {
	got := rules(profiles.violation) with data.vendra.profiles as [{
		"name": "p", "required": ["INSURANCE_GENERAL_LIABILITY"],
		"mandatory": [], "dismissible": [],
		"max_manual_dismissable": 0,
	}]
		with data.vendra.requirement_map as {"W9": ["INSURANCE_GENERAL_LIABILITY"]}
	got == {"coverage_without_insurance_type"}
}

test_coverage_without_insurance_type_is_silent_on_the_real_map if {
	got := rules(profiles.violation) with data.vendra.profiles as [{
		"name": "p", "required": ["INSURANCE_GENERAL_LIABILITY"],
		"mandatory": [], "dismissible": [],
		"max_manual_dismissable": 0,
	}]
	count(got) == 0
}

test_cap_above_dismissible_set_warns if {
	got := rules(profiles.warn) with data.vendra.profiles as [{
		"name": "p", "required": ["TAX_IDENTITY"],
		"mandatory": [], "dismissible": ["TAX_IDENTITY"],
		"max_manual_dismissable": 3,
	}]
	got == {"cap_above_dismissible_set"}
}

test_cap_negative_warns if {
	got := rules(profiles.warn) with data.vendra.profiles as [{
		"name": "p", "required": ["TAX_IDENTITY"],
		"mandatory": [], "dismissible": [],
		"max_manual_dismissable": -1,
	}]
	got == {"cap_negative"}
}

test_mandatory_blocks_remote_only_warns if {
	got := rules(profiles.warn) with data.vendra.profiles as [{
		"name": "p", "required": ["INSURANCE_AUTO"],
		"mandatory": ["INSURANCE_AUTO"], "dismissible": [],
		"max_manual_dismissable": 0,
	}]
	got == {"mandatory_blocks_remote_only"}
}

test_report_aggregates_both_sets if {
	profiles.report == {"violations": set(), "warnings": set()}
}
