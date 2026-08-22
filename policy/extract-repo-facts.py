#!/usr/bin/env python3
"""Bridge the repo's own files into Rego data (C4).

Reads the REAL sources on every run and prints one JSON document under
`repo`, so `policy/repo.rego` can never pass against a stale copy the way a
committed fixture can. Nothing here is written to disk by this script.

    python3 policy/extract-repo-facts.py > /tmp/repo-facts.json
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HARNESS_LANES = {
    "doc-run": "apps/vendra/src/server/harness/doc-run.ts",
    "coverage-runner": "apps/vendra/src/server/harness/coverage-runner.ts",
    "assistant-session": "apps/vendra/src/server/assistant/session.ts",
}


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


# Generated trees that mirror real sources. `next build --output standalone`
# copies `apps/vendra/src/**` into `.next/standalone/`, so without this every
# source-shape invariant double-reports itself against its own build artifact
# (found when the §22 boundary rule fired on `.next/standalone/.../mem0-client.ts`).
GENERATED_DIRS = (".next", "dist", "build", "node_modules", ".turbo")


def git_tracked_or_present(pattern: str, *paths: str) -> list[str]:
    """Files matching an extended regex, excluding generated trees."""
    excludes = [f"--exclude-dir={d}" for d in GENERATED_DIRS]
    cmd = ["grep", "-rlnE", pattern, "--include=*.ts", *excludes, *paths]
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True).stdout
    return sorted(
        p for p in out.splitlines()
        if p and not any(f"/{d}/" in f"/{p}" for d in GENERATED_DIRS)
    )


def compose() -> dict:
    import yaml  # PyYAML; OPA also parses YAML, but one mount keeps roots clean

    return yaml.safe_load(read("docker-compose.yml"))


def packages() -> dict:
    out = {}
    for pj in ["package.json", "apps/vendra/package.json",
               "packages/db-vendor/package.json", "packages/workflow/package.json"]:
        data = json.loads(read(pj))
        out[pj] = {
            "name": data.get("name"),
            "dependencies": sorted(data.get("dependencies", {})),
            "devDependencies": sorted(data.get("devDependencies", {})),
        }
    return out


def harness() -> dict:
    sandbox = read("apps/vendra/src/server/harness/sandbox.ts")
    m = re.search(r"SANDBOX_EGRESS_ALLOWLIST\s*=\s*\[([^\]]*)\]", sandbox)
    allowlist = re.findall(r'"([^"]+)"', m.group(1)) if m else []
    lanes = {}
    for name, rel in HARNESS_LANES.items():
        src = read(rel)
        mode = re.search(r'permissionMode:\s*"([a-z-]+)"', src)
        lanes[name] = {
            "declares_active_tools": "activeTools:" in src,
            "permission_mode": mode.group(1) if mode else None,
            # Rule 2: every createSession/stream call carries an abortSignal.
            "abort_signal_sites": len(re.findall(r"abortSignal", src)),
        }
    # SPEC §24.5: the assistant lane's activeTools must be DERIVED from the
    # resolved privilege tier at lease time, never a hardcoded roster — a
    # literal tool name in session.ts would mean someone re-inlined the list.
    assistant_src = read(HARNESS_LANES["assistant-session"])
    return {"egress_allowlist": allowlist, "lanes": lanes,
            "assistant_active_tools_derived":
                "activeTools: input.activeTools" in assistant_src
                and '"getComplianceState"' not in assistant_src,
            "network_policy_uses_allowlist":
                "networkPolicy: { allow: SANDBOX_EGRESS_ALLOWLIST }" in sandbox}


def governance() -> dict:
    """Integrity of the committed admissibility artifact, by CONTENT.

    mtime is meaningless after a clone, so staleness is the source hash the
    artifact was built from vs the source as it stands now.
    """
    import hashlib

    rego = ROOT / "policy" / "company-policy.rego"
    wasm = ROOT / "policy" / "company-policy.wasm"
    manifest_path = ROOT / "policy" / "company-policy.wasm.json"
    manifest = json.loads(read("policy/company-policy.wasm.json")) if manifest_path.exists() else {}
    rego_hash = (
        hashlib.sha256(rego.read_bytes()).hexdigest() if rego.exists() else None
    )
    # The entrypoint the app actually calls — must match what the module exports.
    admission_src = read("apps/vendra/src/server/policy-admission.ts")
    m = re.search(r'WASM_ENTRYPOINT = "([^"]+)"', admission_src)
    return {
        "wasm_present": wasm.exists(),
        "manifest_present": bool(manifest),
        "wasm_stale": bool(manifest) and manifest.get("rego_sha256") != rego_hash,
        # The BINARY, not just the source: a swapped or truncated .wasm with an
        # intact manifest would otherwise pass every check and load unverified
        # (SPEC §23.1). The runtime loader makes the same comparison and fails
        # closed.
        "wasm_binary_stale": bool(manifest) and wasm.exists()
            and manifest.get("wasm_sha256")
                != hashlib.sha256(wasm.read_bytes()).hexdigest(),
        "entrypoints": manifest.get("entrypoints", []),
        "host_builtins": manifest.get("host_builtins", []),
        "app_entrypoint": m.group(1) if m else None,
        # The six the Node SDK ships (see .claude/skills/opa, hard rule 5).
        "sdk_builtins": [
            "json.is_valid", "regex.split", "sprintf",
            "yaml.is_valid", "yaml.marshal", "yaml.unmarshal",
        ],
    }


def memory() -> dict:
    """Facts for the §22 memory layer's rule-1 constraints.

    mem0 stopped being a forbidden dependency and became a CONSTRAINED one, so
    the invariants moved from "is it declared" to "is it wired the only way that
    keeps rule 1 true": self-hosted providers, no Platform client, telemetry
    provably off, and exactly one module allowed to touch the SDK.
    """
    boundary = "apps/vendra/src/server/memory/mem0-client.ts"
    boundary_src = read(boundary) if (ROOT / boundary).exists() else ""
    compose_raw = read("docker-compose.yml")
    return {
        "boundary_exists": bool(boundary_src),
        # Any file importing the SDK at all — must be the boundary alone.
        "mem0_import_files": git_tracked_or_present(
            r'from "mem0ai|require\("mem0ai', "apps", "packages"),
        # The ROOT export is the hosted MemoryClient; only `mem0ai/oss` is ours.
        "mem0_root_import_files": git_tracked_or_present(
            r'from "mem0ai"', "apps", "packages"),
        # Platform surfaces that must never appear.
        # Anchored to CONSTRUCTION of the hosted client, so our own
        # `getMemoryClient` / `Mem0Client` names do not read as violations.
        "platform_client_files": git_tracked_or_present(
            r"new MemoryClient|MEM0_API_KEY|@mem0/vercel-ai-provider|api\.mem0\.ai",
            "apps", "packages"),
        # Telemetry: the boundary must force it off before its dynamic import,
        # and compose must set it too.
        "boundary_sets_telemetry_false": bool(
            re.search(r'MEM0_TELEMETRY\s*=\s*"false"', boundary_src)),
        "boundary_uses_dynamic_import": bool(
            re.search(r'await import\("mem0ai/oss"\)', boundary_src)),
        "compose_sets_telemetry_false": bool(
            re.search(r'MEM0_TELEMETRY:\s*"false"', compose_raw)),
        # Providers actually configured in the boundary.
        "embedder_provider": (
            m.group(1) if (m := re.search(
                r'embedder:\s*\{\s*provider:\s*"([a-z_]+)"', boundary_src)) else None),
        "vector_provider": (
            m.group(1) if (m := re.search(
                r'vectorStore:\s*\{\s*provider:\s*"([a-z_]+)"', boundary_src)) else None),
        # Index endpoints as compose configures them — must stay local.
        "qdrant_urls": re.findall(r"VENDOR_QDRANT_URL:\s*(\S+)", compose_raw),
        "ollama_urls": re.findall(r"VENDOR_OLLAMA_URL:\s*(\S+)", compose_raw),
    }


def sources() -> dict:
    test_files = subprocess.run(
        ["find", "apps", "packages", "-not", "-path", "*/node_modules/*",
         "(", "-name", "*.test.ts", "-o", "-name", "*.spec.ts",
         "-o", "-name", "*_test.ts", ")"],
        cwd=ROOT, capture_output=True, text=True).stdout.split()
    auth = read("apps/vendra/src/server/auth.ts")
    disabled = re.search(r"disabledPaths:\s*\[([^\]]*)\]", auth)
    return {
        # `provider: "pg"` is the Drizzle dialect name, not a client — match imports only.
        "pg_client_files": git_tracked_or_present(r'from "pg"|require\("pg"\)', "apps", "packages"),
        "sql_raw_files": git_tracked_or_present(r"sql\.raw", "apps", "packages"),
        "committed_test_files": sorted(test_files),
        "auth_disabled_paths": re.findall(r'"([^"]+)"', disabled.group(1)) if disabled else [],
        "auth_rate_limit_enabled": bool(re.search(r"rateLimit:\s*\{[^}]*enabled:\s*true", auth, re.S)),
    }


if __name__ == "__main__":
    json.dump({"repo": {"compose": compose(), "packages": packages(),
                        "harness": harness(), "sources": sources(),
                        "governance": governance(), "memory": memory()}},
              sys.stdout, indent=2, sort_keys=True)
    print()
