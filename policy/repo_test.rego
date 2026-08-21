package vendra.checks.repo_test

import data.vendra.checks.repo
import rego.v1

# A minimal clean fact set. Each test patches exactly one thing, so a rule that
# fires proves it fires for its own reason and not incidentally.
base := {
	"compose": {"services": {
		"postgres": {"ports": ["5436:5432"], "environment": {"POSTGRES_DB": "vendra"}},
		"minio": {"ports": ["9000:9000", "9001:9001"]},
	}},
	"packages": {"package.json": {"dependencies": [], "devDependencies": []}},
	"harness": {
		"egress_allowlist": ["api.anthropic.com", "*.npmjs.org"],
		"network_policy_uses_allowlist": true,
		"lanes": {"doc-run": {
			"declares_active_tools": true,
			"permission_mode": "allow-reads",
			"abort_signal_sites": 3,
		}},
	},
	"governance": {
		"wasm_present": true,
		"manifest_present": true,
		"wasm_stale": false,
		"entrypoints": ["vendra/policy/admission/decision"],
		"host_builtins": ["sprintf"],
		"app_entrypoint": "vendra/policy/admission/decision",
		"sdk_builtins": ["json.is_valid", "regex.split", "sprintf", "yaml.is_valid", "yaml.marshal", "yaml.unmarshal"],
	},
	"sources": {
		"pg_client_files": ["packages/db-vendor/src/client.ts"],
		"sql_raw_files": [],
		"committed_test_files": [],
		"auth_disabled_paths": ["/sign-up/email"],
		"auth_rate_limit_enabled": true,
	},
}

rules(vs) := {v.rule | some v in vs}

patched(p) := object.union(base, p)

# The real repo, from the facts the runner generates. Fails loudly if a rule
# starts firing on the actual tree.
test_real_repo_is_clean if {
	count(repo.violation) == 0
}

test_clean_fact_set_is_clean if {
	count(repo.violation) == 0 with data.repo as base
}

# --- rule 1 ------------------------------------------------------------------

test_egress_allowlist_change_fires if {
	got := rules(repo.violation) with data.repo as patched({"harness": {"egress_allowlist": ["api.anthropic.com", "*.npmjs.org", "telemetry.example.com"]}})
	got == {"R1_egress_allowlist_changed"}
}

test_unwired_network_policy_fires if {
	got := rules(repo.violation) with data.repo as patched({"harness": {"network_policy_uses_allowlist": false}})
	got == {"R1_network_policy_not_wired"}
}

test_forbidden_dependency_fires if {
	got := rules(repo.violation) with data.repo as patched({"packages": {"apps/vendra/package.json": {
		"dependencies": ["@mem0/vercel-ai-provider"], "devDependencies": [],
	}}})
	got == {"R1_forbidden_dependency"}
}

test_forbidden_dev_dependency_also_fires if {
	got := rules(repo.violation) with data.repo as patched({"packages": {"apps/vendra/package.json": {
		"dependencies": [], "devDependencies": ["@qdrant/js-client-rest"],
	}}})
	got == {"R1_forbidden_dependency"}
}

# --- rule 6 ------------------------------------------------------------------

test_foreign_database_port_fires if {
	got := rules(repo.violation) with data.repo as patched({"compose": {"services": {"other-db": {"ports": ["5435:5432"]}}}})
	got == {"R6_foreign_database_port"}
}

test_moved_postgres_port_fires if {
	got := rules(repo.violation) with data.repo as patched({"compose": {"services": {"postgres": {"ports": ["5432:5432"]}}}})
	got == {"R6_postgres_port_moved"}
}

test_cloud_database_host_fires if {
	got := rules(repo.violation) with data.repo as patched({"compose": {"services": {"app": {
		"ports": [],
		"environment": {"DATABASE_URL": "postgres://u:p@db.abc.neon.tech/vendra"},
	}}}})
	got == {"R6_cloud_database_host"}
}

# --- rule 2 ------------------------------------------------------------------

test_lane_without_active_tools_fires if {
	got := rules(repo.violation) with data.repo as patched({"harness": {"lanes": {"doc-run": {"declares_active_tools": false}}}})
	got == {"R2_lane_without_active_tools"}
}

test_lane_permission_mode_fires if {
	got := rules(repo.violation) with data.repo as patched({"harness": {"lanes": {"doc-run": {"permission_mode": "bypass-permissions"}}}})
	got == {"R2_lane_permission_mode"}
}

test_lane_without_abort_signal_fires if {
	got := rules(repo.violation) with data.repo as patched({"harness": {"lanes": {"doc-run": {"abort_signal_sites": 0}}}})
	got == {"R2_lane_without_abort_signal"}
}

# --- rules 3, 7, 8 -----------------------------------------------------------

test_committed_test_file_fires if {
	got := rules(repo.violation) with data.repo as patched({"sources": {"committed_test_files": ["apps/vendra/src/foo.test.ts"]}})
	got == {"R3_committed_test_file"}
}

test_second_pg_client_fires if {
	got := rules(repo.violation) with data.repo as patched({"sources": {"pg_client_files": [
		"packages/db-vendor/src/client.ts", "apps/vendra/src/server/db.ts",
	]}})
	got == {"R7_second_pg_client"}
}

test_sql_raw_fires if {
	got := rules(repo.violation) with data.repo as patched({"sources": {"sql_raw_files": ["apps/vendra/src/server/x.ts"]}})
	got == {"R7_sql_raw"}
}

test_signup_reopened_fires if {
	got := rules(repo.violation) with data.repo as patched({"sources": {"auth_disabled_paths": []}})
	got == {"R8_signup_endpoint_reopened"}
}

test_rate_limiting_disabled_fires if {
	got := rules(repo.violation) with data.repo as patched({"sources": {"auth_rate_limit_enabled": false}})
	got == {"R8_rate_limiting_disabled"}
}

# --- governance artifact -----------------------------------------------------

test_missing_admission_wasm_fires if {
	got := rules(repo.violation) with data.repo as patched({"governance": {"wasm_present": false}})
	got == {"G1_admission_wasm_missing"}
}

test_stale_admission_wasm_fires if {
	got := rules(repo.violation) with data.repo as patched({"governance": {"wasm_stale": true}})
	got == {"G1_admission_wasm_stale"}
}

test_missing_manifest_fires if {
	got := rules(repo.violation) with data.repo as patched({"governance": {"manifest_present": false}})
	got == {"G2_admission_manifest_missing"}
}

test_entrypoint_mismatch_fires if {
	got := rules(repo.violation) with data.repo as patched({"governance": {"app_entrypoint": "vendra/policy/admission/other"}})
	got == {"G3_admission_entrypoint_mismatch"}
}

test_unavailable_builtin_fires if {
	got := rules(repo.violation) with data.repo as patched({"governance": {"host_builtins": ["sprintf", "time.now_ns"]}})
	got == {"G4_admission_builtin_unavailable"}
}
