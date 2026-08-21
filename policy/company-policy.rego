# METADATA
# title: Company policy admissibility (SPEC §19.5)
# description: |
#   The activation gate for a per-company document policy. Answers exactly one
#   question — is this proposed configuration admissible? — and returns every
#   reason it is not, so the console can show all of them at once.
#
#   Evaluated at ACTIVATION only, in-process via @open-policy-agent/opa-wasm
#   against the bundle built from this file. Nothing here runs per document, and
#   the request path never touches OPA.
#
#   The facts under `input.superset` are generated from the real engines
#   (listDocumentTypeCatalog / listValidatorCatalog / VALIDATORS_BY_DOCUMENT_TYPE)
#   on every call, so this policy cannot pass against a stale copy the way a
#   committed fixture can.
package vendra.policy.admission

import rego.v1

policy := input.policy

superset := input.superset

profiles := input.profiles

# Every category any of the org's requirement profiles asks for.
required_categories := {c |
	some profile in profiles
	some c in profile.required
}

mandatory_categories := {c |
	some profile in profiles
	some c in profile.mandatory
}

# Categories some accepted document type can grant.
grantable_categories := {c |
	some doc in policy.documents
	some c in superset.document_types[doc.document_type].categories
}

# --- the document set --------------------------------------------------------

violation contains v if {
	some doc in policy.documents
	not doc.document_type in object.keys(superset.document_types)
	v := {
		"rule": "unknown_document_type",
		"detail": sprintf("%v is not a document type this system knows", [doc.document_type]),
	}
}

violation contains v if {
	count(policy.documents) == 0
	v := {
		"rule": "no_documents_accepted",
		"detail": "a policy that accepts no document type can never approve a vendor",
	}
}

# --- per-document validators -------------------------------------------------

# The load-bearing one (§19.5). `[].every(...)` is true, so a type with no
# validator would pass every document of that type automatically.
violation contains v if {
	some doc in policy.documents
	count(doc.validators) == 0
	v := {
		"rule": "document_without_validators",
		"detail": sprintf(
			"%v has no validators — every document of that type would pass unchecked",
			[doc.document_type],
		),
	}
}

violation contains v if {
	some doc in policy.documents
	known := superset.document_types[doc.document_type]
	some validator in doc.validators
	not validator in known.validators
	v := {
		"rule": "validator_not_applicable",
		"detail": sprintf("%v cannot run against %v", [validator, doc.document_type]),
	}
}

# --- validator / threshold coherence ----------------------------------------

# A threshold-driven validator whose threshold is zero or missing fails every
# document of that type. Selecting it is a configuration that can never pass, so
# it is refused rather than discovered by a vendor.
threshold_floor := {
	"emr_within_bound": input.thresholds.emrMax,
	"report_recent": input.thresholds.soc2MaxAgeMonths,
}

violation contains v if {
	some doc in policy.documents
	some validator in doc.validators
	some name, floor in threshold_floor
	validator == name
	floor <= 0
	v := {
		"rule": "threshold_makes_validator_unsatisfiable",
		"detail": sprintf(
			"%v selects %v, but its threshold is %v — every document of that type would fail",
			[doc.document_type, validator, floor],
		),
	}
}

# --- per-document fields -----------------------------------------------------

violation contains v if {
	some doc in policy.documents
	known := superset.document_types[doc.document_type]
	some field in doc.extract_fields
	not field in known.fields
	v := {
		"rule": "unknown_field",
		"detail": sprintf("%v has no field %v", [doc.document_type, field]),
	}
}

# A deselected structural field would silently change grants or expiry rather
# than fail a check, so it is refused here as well as re-added at runtime.
violation contains v if {
	some doc in policy.documents
	known := superset.document_types[doc.document_type]
	count(doc.extract_fields) > 0
	some field in known.structural_fields
	not field in doc.extract_fields
	v := {
		"rule": "structural_field_deselected",
		"detail": sprintf(
			"%v.%v feeds a host derivation and cannot be deselected",
			[doc.document_type, field],
		),
	}
}

# --- satisfiability ----------------------------------------------------------

# The generalisation of profiles.rego's unsatisfiable_category rule, from the
# seeded profiles to a proposed configuration.
violation contains v if {
	some category in required_categories
	not category in grantable_categories
	v := {
		"rule": "required_category_ungrantable",
		"detail": sprintf(
			"%v is required but no accepted document type can grant it",
			[category],
		),
	}
}

# --- the referee boundary ----------------------------------------------------

violation contains v if {
	some category in policy.refereeable_categories
	not category in required_categories
	v := {
		"rule": "refereeable_not_required",
		"detail": sprintf(
			"%v is marked refereeable but no profile requires it — the setting has no effect",
			[category],
		),
	}
}

violation contains v if {
	some category in policy.refereeable_categories
	not category in superset.categories
	v := {
		"rule": "unknown_category",
		"detail": sprintf("%v is not a requirement category", [category]),
	}
}

# Withholding autonomy is always allowed, so there is no rule forbidding a
# small refereeable set. But a policy that refers a MANDATORY category should
# say so out loud: activation still succeeds, and the console warns.
warning contains w if {
	some category in mandatory_categories
	not category in policy.refereeable_categories
	w := {
		"rule": "mandatory_category_referred",
		"detail": sprintf(
			"%v is mandatory and will require an officer decision on every vendor",
			[category],
		),
	}
}

warning contains w if {
	some doc in policy.documents
	known := superset.document_types[doc.document_type]
	count(doc.validators) < count(known.validators)
	w := {
		"rule": "validators_reduced",
		"detail": sprintf(
			"%v runs %v of %v available checks",
			[doc.document_type, count(doc.validators), count(known.validators)],
		),
	}
}

# The single entrypoint the app evaluates.
decision := {
	"admissible": count(violation) == 0,
	"violations": violation,
	"warnings": warning,
}
