#!/usr/bin/env bash
# vendra policy checks — dev-time only. Reads this repo's own engines, config
# and sources as Rego data and asserts the invariants they must satisfy.
#
#   bash policy/run-checks.sh
#
# No network, no server, no app dependency: `opa eval` and `opa test` only.
# Exit 0 = every check held.
#
# Two pins worth knowing:
#   --capabilities capabilities-pinned.json  drops http.send / net.lookup_ip_addr
#     / opa.runtime, so a check here CANNOT grow a dependency on the network
#     (rule 1, enforced on the checking tool instead of merely asserted).
#   -m 0 lifts `opa check`'s default 10-error cap, which silently truncates.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPA="${OPA:-$HOME/.local/bin/opa}"
CAPS="$DIR/capabilities-pinned.json"
DATA="$DIR/data"
FAIL=0

command -v "$OPA" >/dev/null 2>&1 || { echo "opa not found at $OPA"; exit 127; }

head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }
run() {
  local label="$1"; shift
  if "$@" >/tmp/opa-vendra.$$ 2>&1; then
    printf '  \033[32mok\033[0m    %s\n' "$label"
  else
    printf '  \033[31mFAIL\033[0m  %s\n' "$label"; sed 's/^/        /' /tmp/opa-vendra.$$; FAIL=$((FAIL+1))
  fi
  rm -f /tmp/opa-vendra.$$
}

head_ "Lint + compile (strict, capability-pinned, no error cap)"
run "opa fmt"    "$OPA" fmt --fail --list "$DIR"
run "opa check"  "$OPA" check --strict -m 0 --capabilities "$CAPS" "$DIR"

# The pin must stay honest against the installed binary (SPEC §23.12): a pin
# that references built-ins or ABI versions the binary lacks breaks every suite
# silently on the next opa upgrade. The pin remaining a deliberate SUBSET
# (no http.send etc.) stays legal — only pin-not-supported-by-binary fails.
head_ "Capability pin freshness (pin vs 'opa capabilities --current')"
check_pin_freshness() {
  local current
  current="$(mktemp)" || return 1
  "$OPA" capabilities --current > "$current" || { rm -f "$current"; return 1; }
  PIN="$CAPS" CURRENT="$current" python3 - <<'PY'
import json, os, sys
pin = json.load(open(os.environ["PIN"]))
cur = json.load(open(os.environ["CURRENT"]))
pin_b = {b["name"] for b in pin.get("builtins", [])}
cur_b = {b["name"] for b in cur.get("builtins", [])}
missing = sorted(pin_b - cur_b)
if missing:
    sys.exit(f"pin declares builtins the binary lacks: {missing}")
cur_abi = set(cur.get("wasm_abi_versions") and
              [f"{v['version']}.{v['minor_version']}" for v in cur["wasm_abi_versions"]] or [])
pin_abi = set(pin.get("wasm_abi_versions") and
              [f"{v['version']}.{v['minor_version']}" for v in pin["wasm_abi_versions"]] or [])
unsupported = sorted(pin_abi - cur_abi)
if unsupported:
    sys.exit(f"pin declares wasm ABI versions the binary lacks: {unsupported}")
PY
  local rc=$?
  rm -f "$current"
  return $rc
}
run "capability pin" check_pin_freshness

# Repo invariants read the REAL files on every run — never a committed copy.
head_ "Repo invariants — CLAUDE.md rules 1/2/3/6/7/8 (C4)"
FACTS="$(mktemp)"; trap 'rm -f "$FACTS"' EXIT
if python3 "$DIR/extract-repo-facts.py" > "$FACTS"; then
  printf '  \033[32mok\033[0m    extracted repo facts from source\n'
  run "repo invariants" "$OPA" test --capabilities "$CAPS" --coverage --threshold 95 \
      "$DIR/repo.rego" "$DIR/repo_test.rego" "$FACTS"
  "$OPA" eval -d "$DIR/repo.rego" -d "$FACTS" --format pretty 'data.vendra.checks.repo.report'
else
  printf '  \033[31mFAIL\033[0m  extract-repo-facts.py\n'; sed 's/^/        /' "$FACTS"; FAIL=$((FAIL+1))
fi

head_ "Requirement-profile satisfiability"
run "profiles" "$OPA" test --capabilities "$CAPS" --coverage --threshold 99 \
    "$DIR/profiles.rego" "$DIR/profiles_test.rego" "$DATA/profiles.json"
"$OPA" eval -d "$DIR/profiles.rego" -d "$DATA/profiles.json" --format pretty \
  'data.vendra.checks.profiles.report'

head_ "Coverage-payload adjudication (SPEC §18 D2 + the §23.12 case table)"
run "coverage" "$OPA" test --capabilities "$CAPS" --coverage --threshold 97 \
    "$DIR/coverage.rego" "$DIR/coverage_test.rego" "$DATA/coverage-cases.json"

head_ "Company-policy admissibility (SPEC §19.5)"
run "admissibility" "$OPA" test --capabilities "$CAPS" --coverage --threshold 98 \
    "$DIR/company-policy.rego" "$DIR/company-policy_test.rego"

head_ "Referee boundary (SPEC §19.4)"
run "referee boundary" "$OPA" test --capabilities "$CAPS" --coverage --threshold 90 \
    "$DIR/policy-resolver.rego" "$DIR/policy-resolver_test.rego"
"$OPA" eval -d "$DIR/policy-resolver.rego" --format pretty \
  'data.vendra.checks.resolver.summary'

# 16,384 scenarios — needs the timeout raised off its 5s default (hard rule 11).
head_ "Activation-gate state space (SPEC §18 D1)"
run "gate" "$OPA" test --capabilities "$CAPS" --timeout 300s --coverage --threshold 87 \
    "$DIR/gate.rego" "$DIR/gate_test.rego"
"$OPA" eval -d "$DIR/gate.rego" --format pretty 'data.vendra.checks.gate.summary'

# Properties that quantify over the ENGINES, which Rego cannot call (§19.2/§19.6/§6.6).
head_ "Engine invariants (TypeScript — Rego cannot call the engines)"
if command -v pnpm >/dev/null 2>&1; then
  run "engine invariants" pnpm --filter vendra exec tsx "$DIR/verify-engine-invariants.ts"
else
  printf '  \033[33mskip\033[0m  engine invariants (pnpm not on PATH)\n'
fi

head_ "Result"
if [ "$FAIL" -eq 0 ]; then echo "  all checks held"; else echo "  $FAIL failing check(s)"; fi
exit $((FAIL > 0))
