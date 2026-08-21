# METADATA
# title: Requirement-profile satisfiability
# description: |
#   Structural + reachability checks over vendra requirement profiles
#   (vendor_requirement_profile rows) against the document catalog
#   (VENDOR_REQUIREMENT_MAP) and the implemented grant paths.
#   A profile that requires a category nothing can grant is a vendor that can
#   never activate without officer intervention.
package vendra.checks.profiles

catalog := {c | some c in data.vendra.catalog}

coverage_categories := {c | some c in data.vendra.coverage_categories}

insurance_types := {t | some t in data.vendra.insurance_document_types}

# Every category some document type in the catalog can evidence.
document_grantable := {cat |
	some _, cats in data.vendra.requirement_map
	some cat in cats
}

# Every category an IMPLEMENTED automated path can grant (api-check et al.).
automated_grantable := {cat |
	some _, path in data.vendra.automated_grant_paths
	path.implemented
	some cat in path.categories
}

# deriveAllowedDocumentTypes(): the classification allowlist a profile induces.
allowed_types(required) := {t |
	some t, cats in data.vendra.requirement_map
	some cat in cats
	cat in required
}

# --- structural violations ---------------------------------------------------

violation contains v if {
	some p in data.vendra.profiles
	some cat in p.mandatory
	not cat in {c | some c in p.required}
	v := {
		"profile": p.name,
		"rule": "mandatory_not_required",
		"detail": sprintf("mandatory %v is absent from required", [cat]),
	}
}

violation contains v if {
	some p in data.vendra.profiles
	some cat in p.dismissible
	not cat in {c | some c in p.required}
	v := {
		"profile": p.name,
		"rule": "dismissible_not_required",
		"detail": sprintf("dismissible %v is absent from required", [cat]),
	}
}

violation contains v if {
	some p in data.vendra.profiles
	some cat in p.mandatory
	cat in {c | some c in p.dismissible}
	v := {
		"profile": p.name,
		"rule": "mandatory_is_dismissible",
		"detail": sprintf("%v is both mandatory and dismissible", [cat]),
	}
}

violation contains v if {
	some p in data.vendra.profiles
	some cat in array.concat(p.required, array.concat(p.mandatory, p.dismissible))
	not cat in catalog
	v := {
		"profile": p.name,
		"rule": "unknown_category",
		"detail": sprintf("%v is not a RequirementCategory", [cat]),
	}
}

violation contains v if {
	some p in data.vendra.profiles
	count(p.required) == 0
	v := {
		"profile": p.name,
		"rule": "empty_required",
		"detail": "a profile requiring nothing activates every vendor unconditionally",
	}
}

# --- reachability violations --------------------------------------------------

# The bug class: a required category no document type and no implemented
# automated path can grant. Only an officer manual grant or waiver clears it.
violation contains v if {
	some p in data.vendra.profiles
	some cat in p.required
	cat in catalog
	not cat in document_grantable
	not cat in automated_grantable
	v := {
		"profile": p.name,
		"rule": "unsatisfiable_category",
		"detail": sprintf(
			"required %v is granted by no document type and no implemented automated path",
			[cat],
		),
	}
}

# A coverage category is granted by the coverage-determination lane only, and
# that lane only runs on insurance documents the classifier is allowed to emit.
violation contains v if {
	some p in data.vendra.profiles
	some cat in p.required
	cat in coverage_categories
	count(allowed_types(p.required) & insurance_types) == 0
	v := {
		"profile": p.name,
		"rule": "coverage_without_insurance_type",
		"detail": sprintf(
			"required %v needs the coverage lane, but no insurance document type is classifiable",
			[cat],
		),
	}
}

# --- dead configuration (warnings) -------------------------------------------

warn contains w if {
	some p in data.vendra.profiles
	p.max_manual_dismissable > count(p.dismissible)
	w := {
		"profile": p.name,
		"rule": "cap_above_dismissible_set",
		"detail": sprintf(
			"maxManualDismissable %v exceeds the %v dismissible categories",
			[p.max_manual_dismissable, count(p.dismissible)],
		),
	}
}

warn contains w if {
	some p in data.vendra.profiles
	p.max_manual_dismissable < 0
	w := {
		"profile": p.name,
		"rule": "cap_negative",
		"detail": "a negative cap silently honours zero dismissals",
	}
}

# A mandatory category can never be dismissed, so a work profile that
# auto-dismisses it is a permanent block rather than a relief.
warn contains w if {
	some p in data.vendra.profiles
	some cat in {"INSURANCE_AUTO", "INSURANCE_WORKERS_COMP"}
	cat in {c | some c in p.mandatory}
	w := {
		"profile": p.name,
		"rule": "mandatory_blocks_remote_only",
		"detail": sprintf(
			"%v is mandatory, so deriveAutoDismissedCategories cannot relieve a remote-only vendor",
			[cat],
		),
	}
}

report := {"violations": violation, "warnings": warn}
