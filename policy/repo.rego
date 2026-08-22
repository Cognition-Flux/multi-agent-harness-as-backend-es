# METADATA
# title: vendra repo invariants
# description: |
#   The machine-checkable subset of the eight hard rules in .claude/CLAUDE.md,
#   evaluated against facts extracted from the REAL files on every run
#   (policy/extract-repo-facts.py) rather than a committed copy.
#
#   Package is `vendra.checks.repo` while the data root is `data.repo` — the
#   two must not collide, or every rule here fails with rego_recursion_error.
package vendra.checks.repo

import rego.v1

# --- rule 1: external reliance is exactly the Anthropic API + Vercel Sandbox --

expected_egress := ["api.anthropic.com", "*.npmjs.org"]

# Packages that would each add an external host this repo does not own.
forbidden_deps := {
	"@mem0/vercel-ai-provider": "Mem0 Platform (cloud) client",
	# `mem0ai` and `@qdrant/js-client-rest` were on this list until §22 adopted
	# a SELF-HOSTED memory index. They are now CONSTRAINED rather than banned —
	# see the memory-layer rules below, which assert the only wiring that keeps
	# rule 1 true (local providers, no Platform client, telemetry off, one
	# boundary module). The Platform provider above stays banned outright.
	"@vercel/ai-gateway": "Vercel AI Gateway",
	"@ai-sdk/gateway": "Vercel AI Gateway",
}

violation contains v if {
	data.repo.harness.egress_allowlist != expected_egress
	v := {
		"rule": "R1_egress_allowlist_changed",
		"detail": sprintf(
			"SANDBOX_EGRESS_ALLOWLIST is %v, expected %v",
			[data.repo.harness.egress_allowlist, expected_egress],
		),
	}
}

violation contains v if {
	not data.repo.harness.network_policy_uses_allowlist
	v := {
		"rule": "R1_network_policy_not_wired",
		"detail": "the sandbox no longer passes SANDBOX_EGRESS_ALLOWLIST to networkPolicy — the allowlist is inert",
	}
}

violation contains v if {
	some manifest, pkg in data.repo.packages
	some dep in array.concat(pkg.dependencies, pkg.devDependencies)
	some forbidden, why in forbidden_deps
	dep == forbidden
	v := {
		"rule": "R1_forbidden_dependency",
		"detail": sprintf("%v declares %v (%v)", [manifest, dep, why]),
	}
}

# --- rule 1 (cont.): the memory index stays self-hosted (§22) ----------------

# The SDK is reachable from exactly one module. mem0 has a hosted client, a
# Platform provider and 25 vector stores pointing at other people's servers;
# containing all of that to one file is what makes the rest of this section
# checkable at all.
violation contains v if {
	some file in data.repo.memory.mem0_import_files
	file != "apps/vendra/src/server/memory/mem0-client.ts"
	v := {
		"rule": "R1_mem0_outside_boundary",
		"detail": sprintf("%v imports mem0ai — only server/memory/mem0-client.ts may", [file]),
	}
}

# `mem0ai` (root) is the HOSTED MemoryClient; `mem0ai/oss` is the self-hosted
# Memory. Importing the root is how a cloud dependency arrives by accident.
violation contains v if {
	some file in data.repo.memory.mem0_root_import_files
	v := {
		"rule": "R1_mem0_hosted_entrypoint",
		"detail": sprintf("%v imports \"mem0ai\" (the hosted client) — use \"mem0ai/oss\"", [file]),
	}
}

violation contains v if {
	some file in data.repo.memory.platform_client_files
	v := {
		"rule": "R1_mem0_platform_surface",
		"detail": sprintf("%v references the Mem0 Platform (MemoryClient / MEM0_API_KEY / api.mem0.ai)", [file]),
	}
}

# mem0 3.1.6 POSTs to PostHog unless MEM0_TELEMETRY is exactly "false", read at
# module load. Two independent guarantees, because one is easy to lose in a
# refactor: the boundary sets it before its dynamic import, and compose sets it
# for the container.
violation contains v if {
	data.repo.memory.boundary_exists
	not data.repo.memory.boundary_sets_telemetry_false
	v := {
		"rule": "R1_mem0_telemetry_unguarded",
		"detail": "server/memory/mem0-client.ts no longer forces MEM0_TELEMETRY=false — mem0 defaults to sending PostHog events",
	}
}

# A static import would be hoisted above the assignment above, so the env var
# would be read before we set it. The dynamic import IS the mechanism.
violation contains v if {
	data.repo.memory.boundary_exists
	not data.repo.memory.boundary_uses_dynamic_import
	v := {
		"rule": "R1_mem0_static_import",
		"detail": "the boundary imports mem0ai/oss statically — hoisting defeats the MEM0_TELEMETRY guard",
	}
}

violation contains v if {
	data.repo.memory.boundary_exists
	not data.repo.memory.compose_sets_telemetry_false
	v := {
		"rule": "R1_mem0_telemetry_unset_in_compose",
		"detail": "docker-compose.yml no longer sets MEM0_TELEMETRY: \"false\" for the app",
	}
}

# Providers must be the local ones. `openai`/`aws_bedrock`/`gemini` embedders and
# any hosted vector store would each be a new external host.
local_embedders := {"ollama", "lmstudio", "fastembed", "huggingface"}

local_vector_stores := {"qdrant", "memory", "pgvector", "redis", "milvus"}

violation contains v if {
	data.repo.memory.boundary_exists
	not data.repo.memory.embedder_provider in local_embedders
	v := {
		"rule": "R1_mem0_remote_embedder",
		"detail": sprintf("embedder provider %v is not self-hostable", [data.repo.memory.embedder_provider]),
	}
}

violation contains v if {
	data.repo.memory.boundary_exists
	not data.repo.memory.vector_provider in local_vector_stores
	v := {
		"rule": "R1_mem0_remote_vector_store",
		"detail": sprintf("vector store %v is not self-hostable", [data.repo.memory.vector_provider]),
	}
}

# The endpoints compose hands the app must be container-internal. A cloud
# Qdrant URL here is the exact failure the qdrant skill warns about.
violation contains v if {
	some url in array.concat(data.repo.memory.qdrant_urls, data.repo.memory.ollama_urls)
	not startswith(url, "http://qdrant:")
	not startswith(url, "http://ollama:")
	v := {
		"rule": "R1_memory_endpoint_not_local",
		"detail": sprintf("memory endpoint %v is not a compose-internal host", [url]),
	}
}

# --- rule 6: this repo owns its database ------------------------------------

# 5435 is a common local-postgres port belonging to another app; this repo's
# postgres is host-side 5436.
violation contains v if {
	some name, service in data.repo.compose.services
	some port in service.ports
	contains(port, "5435")
	v := {
		"rule": "R6_foreign_database_port",
		"detail": sprintf("compose service %v publishes %v — 5435 is not this repo's postgres", [name, port]),
	}
}

violation contains v if {
	not "5436:5432" in {p | some p in data.repo.compose.services.postgres.ports}
	v := {
		"rule": "R6_postgres_port_moved",
		"detail": "the postgres service no longer publishes 5436:5432",
	}
}

violation contains v if {
	some name, service in data.repo.compose.services
	some _, env in service.environment
	regex.match(`(rds\.amazonaws\.com|\.neon\.tech|\.supabase\.co|\.render\.com)`, env)
	v := {
		"rule": "R6_cloud_database_host",
		"detail": sprintf("compose service %v points at a hosted database", [name]),
	}
}

# --- rule 2: the harness pins ------------------------------------------------

violation contains v if {
	some lane, cfg in data.repo.harness.lanes
	not cfg.declares_active_tools
	v := {
		"rule": "R2_lane_without_active_tools",
		"detail": sprintf("harness lane %v declares no activeTools — the agent gets the full tool surface", [lane]),
	}
}

violation contains v if {
	some lane, cfg in data.repo.harness.lanes
	cfg.permission_mode != "allow-reads"
	v := {
		"rule": "R2_lane_permission_mode",
		"detail": sprintf("harness lane %v runs with permissionMode %v, expected allow-reads", [lane, cfg.permission_mode]),
	}
}

violation contains v if {
	some lane, cfg in data.repo.harness.lanes
	cfg.abort_signal_sites == 0
	v := {
		"rule": "R2_lane_without_abort_signal",
		"detail": sprintf("harness lane %v never references abortSignal", [lane]),
	}
}

# --- rule 3: no test files committed ----------------------------------------

violation contains v if {
	some f in data.repo.sources.committed_test_files
	v := {
		"rule": "R3_committed_test_file",
		"detail": sprintf("%v is a committed test file", [f]),
	}
}

# --- rule 7: Drizzle is the only database interaction ------------------------

allowed_pg_clients := {
	"packages/db-vendor/src/client.ts",
	"packages/db-vendor/src/migrate.ts",
}

violation contains v if {
	some f in data.repo.sources.pg_client_files
	not f in allowed_pg_clients
	v := {
		"rule": "R7_second_pg_client",
		"detail": sprintf("%v imports the pg driver outside packages/db-vendor/src/{client,migrate}.ts", [f]),
	}
}

violation contains v if {
	some f in data.repo.sources.sql_raw_files
	v := {
		"rule": "R7_sql_raw",
		"detail": sprintf("%v uses sql.raw — the parameterised sql`` tag only", [f]),
	}
}

# --- rule 8: auth stays local and seedable ----------------------------------

violation contains v if {
	not "/sign-up/email" in {p | some p in data.repo.sources.auth_disabled_paths}
	v := {
		"rule": "R8_signup_endpoint_reopened",
		"detail": "/sign-up/email left disabledPaths — registration must flow through /api/vendor/register",
	}
}

violation contains v if {
	not data.repo.sources.auth_rate_limit_enabled
	v := {
		"rule": "R8_rate_limiting_disabled",
		"detail": "better-auth rateLimit.enabled is not true — it stays on in every run mode",
	}
}

# --- governance artifact (SPEC §19.5) ---------------------------------------

violation contains v if {
	not data.repo.governance.wasm_present
	v := {
		"rule": "G1_admission_wasm_missing",
		"detail": "policy/company-policy.wasm is absent — activation would fail closed; run `pnpm --filter vendra policy:build`",
	}
}

violation contains v if {
	data.repo.governance.wasm_stale
	v := {
		"rule": "G1_admission_wasm_stale",
		"detail": "policy/company-policy.wasm was built from a different company-policy.rego — the activation gate is running yesterday's rules; run `pnpm --filter vendra policy:build`",
	}
}

# The BINARY itself, not just the source it claims to come from: a swapped or
# truncated .wasm with an intact manifest passes G1/G2 and would load
# unverified. The runtime loader makes the same comparison and fails closed
# (SPEC §23.1).
violation contains v if {
	data.repo.governance.wasm_binary_stale
	v := {
		"rule": "G1_admission_wasm_binary_stale",
		"detail": "policy/company-policy.wasm does not hash to the manifest's wasm_sha256 — the committed artifact was edited or half-rebuilt; run `pnpm --filter vendra policy:build`",
	}
}

violation contains v if {
	data.repo.governance.wasm_present
	not data.repo.governance.manifest_present
	v := {
		"rule": "G2_admission_manifest_missing",
		"detail": "company-policy.wasm.json is absent, so artifact integrity cannot be checked at all",
	}
}

# The app calls one entrypoint by name; a module that does not export it fails
# closed at activation, which is exactly when you least want to discover it.
violation contains v if {
	entry := data.repo.governance.app_entrypoint
	entry != null
	count(data.repo.governance.entrypoints) > 0
	not entry in {e | some e in data.repo.governance.entrypoints}
	v := {
		"rule": "G3_admission_entrypoint_mismatch",
		"detail": sprintf(
			"policy-admission.ts calls %v, but the module exports %v",
			[entry, data.repo.governance.entrypoints],
		),
	}
}

# opa-wasm ships exactly six host built-ins; anything else the module needs
# throws at evaluation time (opa skill, hard rule 5).
violation contains v if {
	some required in data.repo.governance.host_builtins
	not required in {b | some b in data.repo.governance.sdk_builtins}
	v := {
		"rule": "G4_admission_builtin_unavailable",
		"detail": sprintf(
			"the module requires host built-in %v, which @open-policy-agent/opa-wasm does not implement",
			[required],
		),
	}
}

# The assistant's tool surface is governed policy data (SPEC §24.5): the lease
# derives activeTools from the vendor's privilege tier, so a hardcoded roster
# in session.ts would silently disconnect the tier from what the model can do.
violation contains v if {
	not data.repo.harness.assistant_active_tools_derived
	v := {
		"rule": "G5_assistant_tools_not_policy_derived",
		"detail": "assistant session.ts must pass the lease's activeTools through (derived from the privilege tier), never a hardcoded tool list",
	}
}

report := {"violations": violation, "count": count(violation)}
