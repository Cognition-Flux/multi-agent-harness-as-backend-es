package vendra.checks.gate_test

import data.vendra.checks.gate

# The four invariants the gate's comments claim, over all 16,384 scenarios.
test_invariants_hold_across_the_state_space if {
	count(gate.scenarios) == 16384
	count(gate.inv_no_double_credit_violation) == 0
	count(gate.inv_mandatory_absorbed_violation) == 0
	count(gate.inv_cap_violation) == 0
	count(gate.inv_scope_violation) == 0
	count(gate.inv_expired_satisfies_violation) == 0
	count(gate.inv_cap_wasted_violation) == 0
	count(gate.inv_d1_size_violation) == 0
	count(gate.inv_d1_scope_violation) == 0
}

# What the profile does NOT decide: 96 scenarios where activation depends on
# which qualifying dismissals get honoured.
test_order_sensitive_scenarios_exist if {
	count(gate.order_sensitive) == 96
}

test_canonical_order_sensitive_scenario if {
	scenario := {
		"sat": {
			"TAX_IDENTITY": "grant_active",
			"BANKING_VERIFICATION": "grant_active",
			"DIVERSITY_CERTIFICATION": "grant_active",
			"INSURANCE_AUTO": "grant_active",
			"SAFETY_RECORD": "grant_expired",
		},
		"manual": {"DIVERSITY_CERTIFICATION", "INSURANCE_AUTO", "SAFETY_RECORD"},
		"remote_only": false,
	}
	scenario in gate.order_sensitive
	gate.clearances(scenario) == {true, false}
}

# SPEC §18 D1 on the scenario that used to flip: the cap goes to the only
# unsatisfied category, so the vendor clears — whatever order the column holds.
test_d1_spends_the_cap_where_relief_is_needed if {
	scenario := {
		"sat": {
			"TAX_IDENTITY": "grant_active",
			"BANKING_VERIFICATION": "grant_active",
			"DIVERSITY_CERTIFICATION": "grant_active",
			"INSURANCE_AUTO": "grant_active",
			"SAFETY_RECORD": "grant_expired",
		},
		"manual": {"DIVERSITY_CERTIFICATION", "INSURANCE_AUTO", "SAFETY_RECORD"},
		"remote_only": false,
	}
	gate.honoured_d1(scenario) == ["SAFETY_RECORD", "DIVERSITY_CERTIFICATION"]
	gate.outcome(scenario, {c | some c in gate.honoured_d1(scenario)}).cleared
}

# Reachable without any direct DB write: the org lowers the cap (or shrinks
# `dismissible`) after the vendor's toggles are already persisted, and nothing
# re-validates the array.
test_lowered_cap_reopens_order_sensitivity if {
	count(gate.order_sensitive) > 0 with data.vendra.checks.gate.profile as {
		"required": ["TAX_IDENTITY", "DIVERSITY_CERTIFICATION", "SAFETY_RECORD"],
		"mandatory": ["TAX_IDENTITY"],
		"dismissible": ["DIVERSITY_CERTIFICATION", "SAFETY_RECORD"],
		"max_manual_dismissable": 1,
	}
}

# The fix direction, verified: when the cap can never bite, no scenario is
# order-sensitive. (A deterministic tie-break — sorting before the slice —
# has the same effect without changing any profile.)
test_cap_covering_the_dismissible_set_is_deterministic if {
	count(gate.order_sensitive) == 0 with data.vendra.checks.gate.profile as {
		"required": [
			"TAX_IDENTITY", "BANKING_VERIFICATION", "DIVERSITY_CERTIFICATION",
			"INSURANCE_AUTO", "SAFETY_RECORD",
		],
		"mandatory": ["TAX_IDENTITY"],
		"dismissible": ["DIVERSITY_CERTIFICATION", "INSURANCE_AUTO", "SAFETY_RECORD"],
		"max_manual_dismissable": 3,
	}
}
