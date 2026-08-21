# METADATA
# title: Activation-gate state-space model
# description: |
#   An order-INDEPENDENT mirror of calculateActivationGate() over the
#   construction-sub profile, enumerated across every satisfaction state.
#   Where the honoured-dismissal subset is underdetermined by the profile
#   (more qualifying manual dismissals than the cap), the mirror computes the
#   best and worst outcome; a scenario where they differ is one the PROFILE does
#   not decide. `order_sensitive` counts those and is expected to stay non-zero:
#   it measures profile ambiguity, not a defect.
#
#   SPEC §18 D1 fixed who resolves that ambiguity. It used to be the order of
#   the `dismissed_categories` column; it is now a stated rule, modelled below
#   as `honoured_d1` and asserted by the `inv_d1_*` invariants.
package vendra.checks.gate

profile := {
	"required": [
		"TAX_IDENTITY", "BANKING_VERIFICATION", "DIVERSITY_CERTIFICATION",
		"INSURANCE_AUTO", "SAFETY_RECORD",
	],
	"mandatory": ["TAX_IDENTITY"],
	"dismissible": ["DIVERSITY_CERTIFICATION", "INSURANCE_AUTO", "SAFETY_RECORD"],
	"max_manual_dismissable": 2,
}

required_set := {c | some c in profile.required}

mandatory_set := {c | some c in profile.mandatory}

dismissible_set := {c | some c in profile.dismissible}

# none: no evidence. grant_active: unexpired grant. grant_expired: lapsed
# document/waiver grant. waiver_expired: officer waiver past its expiry.
sat_states := ["none", "grant_active", "grant_expired", "waiver_expired"]

manual_subsets := {s |
	some a in [true, false]
	some b in [true, false]
	some c in [true, false]
	s := ({"DIVERSITY_CERTIFICATION" | a} | {"INSURANCE_AUTO" | b}) | {"SAFETY_RECORD" | c}
}

scenarios contains s if {
	some a in sat_states
	some b in sat_states
	some c in sat_states
	some d in sat_states
	some e in sat_states
	some manual in manual_subsets
	some remote in [true, false]
	s := {
		"sat": {
			"TAX_IDENTITY": a,
			"BANKING_VERIFICATION": b,
			"DIVERSITY_CERTIFICATION": c,
			"INSURANCE_AUTO": d,
			"SAFETY_RECORD": e,
		},
		"manual": manual,
		"remote_only": remote,
	}
}

satisfied(s, cat) if s.sat[cat] == "grant_active"

# deriveAutoDismissedCategories(): remote-only relieves auto + workers' comp,
# never a mandatory category.
auto_dismissed(s) := {cat |
	some cat in {"INSURANCE_AUTO", "INSURANCE_WORKERS_COMP"}
	s.remote_only
	cat in required_set
	not cat in mandatory_set
}

# The manual dismissals that qualify before the cap is applied.
qualifying(s) := {cat |
	some cat in s.manual
	cat in dismissible_set
	not cat in mandatory_set
}

# Every subset the cap can honour. The profile fixes the SIZE
# (min(cap, |qualifying|)) and says nothing about WHICH.
powerset(xs) := {sub |
	arr := [x | some x in xs]
	n := count(arr)
	some mask in numbers.range(0, bits.lsh(1, n) - 1)
	sub := {arr[i] |
		some i in numbers.range(0, n - 1)
		bits.and(mask, bits.lsh(1, i)) != 0
	}
}

honoured_options(s) := opts if {
	q := qualifying(s)
	k := min([profile.max_manual_dismissable, count(q)])
	opts := {sub |
		some sub in powerset(q)
		count(sub) == k
	}
}

# SPEC §18 D1 — the subset the implementation now honours: unsatisfied
# categories first (the cap buys relief where relief is needed), then
# `profile.dismissible` order, sliced to the cap.
honoured_d1(s) := result if {
	q := qualifying(s)
	ordered := array.concat(
		[c | some c in profile.dismissible; c in q; not satisfied(s, c)],
		[c | some c in profile.dismissible; c in q; satisfied(s, c)],
	)
	result := array.slice(ordered, 0, min([profile.max_manual_dismissable, count(ordered)]))
}

outcome(s, honoured) := {"cleared": cleared, "blocking": blocking} if {
	dismissed := auto_dismissed(s) | honoured
	blocking := {cat |
		some cat in required_set
		not cat in dismissed
		not satisfied(s, cat)
	}
	missing_mandatory := {cat |
		some cat in mandatory_set
		not satisfied(s, cat)
	}
	cleared := count(blocking) == 0
	count(missing_mandatory) == 0
}

outcome(s, honoured) := {"cleared": false, "blocking": blocking} if {
	dismissed := auto_dismissed(s) | honoured
	blocking := {cat |
		some cat in required_set
		not cat in dismissed
		not satisfied(s, cat)
	}
	some cat in mandatory_set
	not satisfied(s, cat)
}

clearances(s) := {o.cleared | some h in honoured_options(s); o := outcome(s, h)}

# The finding: the profile alone does not decide activation here.
order_sensitive contains s if {
	some s in scenarios
	count(clearances(s)) > 1
}

# INVARIANT 1 — a dismissed category is never also counted satisfied.
inv_no_double_credit_violation contains s if {
	some s in scenarios
	some h in honoured_options(s)
	o := outcome(s, h)
	some cat in (auto_dismissed(s) | h)
	cat in o.blocking
}

# INVARIANT 2 — dismissals can never absorb a mandatory category.
inv_mandatory_absorbed_violation contains s if {
	some s in scenarios
	some h in honoured_options(s)
	o := outcome(s, h)
	o.cleared
	some cat in mandatory_set
	not satisfied(s, cat)
}

# INVARIANT 3 — honoured dismissals stay within the cap and the dismissible set.
inv_cap_violation contains s if {
	some s in scenarios
	some h in honoured_options(s)
	count(h) > profile.max_manual_dismissable
}

inv_scope_violation contains s if {
	some s in scenarios
	some h in honoured_options(s)
	some cat in h
	not cat in dismissible_set
}

# INVARIANT 4 — an expired grant or waiver never satisfies.
inv_expired_satisfies_violation contains s if {
	some s in scenarios
	some cat in required_set
	s.sat[cat] in {"grant_expired", "waiver_expired"}
	satisfied(s, cat)
}

# INVARIANT 5 (D1) — the cap is never spent on a category that already has an
# unexpired grant while a qualifying unsatisfied one is left blocking.
inv_cap_wasted_violation contains s if {
	some s in scenarios
	h := {c | some c in honoured_d1(s)}
	some chosen in h
	satisfied(s, chosen)
	some other in qualifying(s)
	not other in h
	not satisfied(s, other)
}

# INVARIANT 6 (D1) — the honoured subset is exactly cap-sized and in scope.
inv_d1_size_violation contains s if {
	some s in scenarios
	count(honoured_d1(s)) != min([profile.max_manual_dismissable, count(qualifying(s))])
}

inv_d1_scope_violation contains s if {
	some s in scenarios
	some c in honoured_d1(s)
	not c in qualifying(s)
}

summary := {
	"scenarios": count(scenarios),
	"order_sensitive": count(order_sensitive),
	"invariant_violations": {
		"no_double_credit": count(inv_no_double_credit_violation),
		"mandatory_absorbed": count(inv_mandatory_absorbed_violation),
		"cap_exceeded": count(inv_cap_violation),
		"scope_exceeded": count(inv_scope_violation),
		"expired_satisfies": count(inv_expired_satisfies_violation),
		"cap_wasted": count(inv_cap_wasted_violation),
		"d1_size": count(inv_d1_size_violation),
		"d1_scope": count(inv_d1_scope_violation),
	},
}
