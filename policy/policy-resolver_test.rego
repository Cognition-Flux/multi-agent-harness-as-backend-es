package vendra.checks.resolver_test

import data.vendra.checks.resolver
import rego.v1

rules(vs) := {v.rule | some v in vs}

# --- the shipped reading holds every invariant -------------------------------

test_shipped_direction_has_no_violations if {
	resolver.summary.scenarios == 20
	resolver.summary.flag_states == 8
	count(resolver.violation) == 0
}

test_officer_sources_are_never_withheld if {
	every kind in ["manual_grant", "waiver"] {
		not resolver.withheld({"required": true, "refereeable": false, "kind": kind})
	}
}

test_the_boundary_bites_on_automated_sources if {
	every kind in ["document", "determination", "api_check"] {
		resolver.withheld({"required": true, "refereeable": false, "kind": kind})
	}
}

test_refereeable_is_never_withheld if {
	not resolver.withheld({"required": true, "refereeable": true, "kind": "determination"})
}

test_non_required_is_never_withheld if {
	not resolver.withheld({"required": false, "refereeable": false, "kind": "document"})
}

# --- the inversion is CAUGHT --------------------------------------------------

# This is why the file exists. The first implementation read the list as
# "categories the pipeline may newly settle", so with the behaviour-preserving
# default (everything refereeable) it withheld everything and granted nothing.
test_inverted_direction_is_caught if {
	got := rules(resolver.violation) with input as {"direction": "grants"}
	"refereeable_withheld" in got
	"boundary_does_not_bite" in got
}

test_inverted_direction_grants_nothing_under_the_default if {
	# Default policy = every required category refereeable. Under the inverted
	# reading an automated source for such a category is withheld — the exact
	# "grants nothing" failure.
	resolver.withheld({"required": true, "refereeable": true, "kind": "determination"}) with input as {"direction": "grants"}
}

# --- flag exclusivity --------------------------------------------------------

test_granted_supersedes_referred if {
	not resolver.resolved_referred({"granted": true, "referred": true, "determining": false})
}

test_referred_supersedes_determining if {
	not resolver.resolved_determining({"granted": false, "referred": true, "determining": true})
}

test_determining_survives_alone if {
	resolver.resolved_determining({"granted": false, "referred": false, "determining": true})
}
