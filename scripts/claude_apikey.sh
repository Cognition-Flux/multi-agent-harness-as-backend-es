#!/usr/bin/env bash
# Launch Claude Code authenticated by ANTHROPIC_API_KEY ALONE — no browser login,
# no OAuth session, no keychain, no subscription credential.
#
# Why the isolated config dir: an approved ANTHROPIC_API_KEY OUTRANKS a /login
# credential (auth precedence: cloud provider > ANTHROPIC_AUTH_TOKEN >
# ANTHROPIC_API_KEY > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > profiles > /login).
# Exporting the key into your normal profile would silently move your everyday
# sessions off your plan and onto API billing. This script therefore keeps its own
# CLAUDE_CONFIG_DIR and leaves your subscription profile untouched.
#
# Usage:
#   ./scripts/claude_apikey.sh                      # interactive TUI
#   ./scripts/claude_apikey.sh --model opus         # any claude flag passes through
#   ./scripts/claude_apikey.sh -p "hola"            # headless
#   ./scripts/claude_apikey.sh --bare -p "hola"     # headless, no repo context
#
# Env overrides:
#   CLAUDE_APIKEY_CONFIG_DIR   config dir            (default ~/.claude-profiles/apikey-only)
#   CLAUDE_APIKEY_ENV_FILE     file holding the key  (default <repo>/.env)
#   CLAUDE_APIKEY_MODEL        default model         (default sonnet; --model wins)
#   CLAUDE_APIKEY_NO_PRESEED=1 skip the one-time approval/trust pre-seed

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CLAUDE_APIKEY_ENV_FILE:-$REPO_ROOT/.env}"
CFG_DIR="${CLAUDE_APIKEY_CONFIG_DIR:-$HOME/.claude-profiles/apikey-only}"
DEFAULT_MODEL="${CLAUDE_APIKEY_MODEL:-sonnet}"

die() { printf 'claude_apikey: %s\n' "$1" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || die "the 'claude' CLI is not on PATH"
[ -r "$ENV_FILE" ] || die "cannot read $ENV_FILE (set CLAUDE_APIKEY_ENV_FILE)"

# Read the key without sourcing the file — .env here also carries Neo4j, AWS and
# Bedrock secrets that have no business in this process's environment.
KEY="$(
  sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?ANTHROPIC_API_KEY[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" \
  | head -1 \
  | sed -E 's/^"(.*)"[[:space:]]*$/\1/; s/^'\''(.*)'\''[[:space:]]*$/\1/' \
  | tr -d '[:space:]'
)"

[ -n "$KEY" ] || die "no ANTHROPIC_API_KEY= line found in $ENV_FILE"
case "$KEY" in
  sk-ant-*) : ;;
  *) die "the ANTHROPIC_API_KEY in $ENV_FILE does not look like a Console key (expected sk-ant-…)" ;;
esac

mkdir -p "$CFG_DIR"

# Pre-seed the two one-time interactive dialogs so the very first launch is usable:
#   1. "approve this custom API key" — stored as the key's last 20 chars
#      (mechanism read out of the CLI bundle: approved token == key.trim().slice(-20))
#   2. the workspace trust dialog for this repo, without which Claude Code ignores
#      every permissions.allow entry in .claude/settings.json
if [ "${CLAUDE_APIKEY_NO_PRESEED:-0}" != "1" ] && command -v python3 >/dev/null 2>&1; then
  CFG_DIR="$CFG_DIR" REPO_ROOT="$REPO_ROOT" KEY_TAIL="${KEY: -20}" python3 - <<'PY' || true
import json, os, pathlib
cfg = pathlib.Path(os.environ["CFG_DIR"]) / ".claude.json"
try:
    data = json.loads(cfg.read_text()) if cfg.exists() else {}
except (ValueError, OSError):
    data = {}
if not isinstance(data, dict):
    data = {}
responses = data.setdefault("customApiKeyResponses", {})
approved = responses.setdefault("approved", [])
tail = os.environ["KEY_TAIL"]
if tail not in approved:
    approved.append(tail)
responses.setdefault("rejected", [])
project = data.setdefault("projects", {}).setdefault(os.environ["REPO_ROOT"], {})
project["hasTrustDialogAccepted"] = True
tmp = cfg.with_suffix(".json.tmp")
tmp.write_text(json.dumps(data, indent=2))
tmp.replace(cfg)
PY
fi

# Neutralise every credential source that would outrank or shadow the API key,
# so what actually authenticates is never in doubt.
unset ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_PROFILE \
      ANTHROPIC_FEDERATION_RULE_ID ANTHROPIC_ORGANIZATION_ID \
      CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY

export ANTHROPIC_API_KEY="$KEY"
export CLAUDE_CONFIG_DIR="$CFG_DIR"

# Only supply a default model when the caller didn't pick one; the CLI's own
# default resolved to opus-5[1m] here, which bills ~$0.012 for a two-word reply.
model_args=()
if [ -z "${ANTHROPIC_MODEL:-}" ] && [[ " $* " != *" --model"* ]]; then
  model_args=(--model "$DEFAULT_MODEL")
fi

printf 'auth: ANTHROPIC_API_KEY (…%s) · config: %s · model: %s\n' \
  "${KEY: -6}" "$CFG_DIR" "${ANTHROPIC_MODEL:-${model_args[1]:-<caller-specified>}}" >&2
printf 'no login, no OAuth session — confirm inside with /status\n' >&2

cd "$REPO_ROOT"
exec claude "${model_args[@]}" "$@"
