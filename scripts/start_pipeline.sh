#!/usr/bin/env bash
# start_pipeline.sh — idempotent launcher for the Inngest dev environment.
#
# Steps:
#   1. Free ports 8000 (uvicorn) and 8290 (inngest-cli, migrated off :8288 to avoid BuildTurbo collision)
#   2. Kill any stale 'inngest' tmux session
#   3. Create tmux session 'inngest' with two windows (uvicorn + inngest-cli)
#   4. Poll until both endpoints respond (max 60s)
#   5. Print monitoring commands

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

TS=$(date -u +%Y%m%dT%H%M%SZ)
LOGS_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOGS_DIR"
UVICORN_LOG="$LOGS_DIR/uvicorn_${TS}.log"
INNGEST_LOG="$LOGS_DIR/inngest_cli_${TS}.log"

# 1) free ports
for port in 8000 8290; do
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "==> port $port busy (pids: $pids), killing..."
        # shellcheck disable=SC2086
        kill -9 $pids 2>/dev/null || true
        sleep 1
    fi
done

# 2) kill stale tmux session
if tmux has-session -t inngest 2>/dev/null; then
    echo "==> killing existing tmux 'inngest' session"
    tmux kill-session -t inngest
fi

# 3) launch
echo "==> creating tmux session 'inngest' (logs: $UVICORN_LOG, $INNGEST_LOG)"
tmux new-session -d -s inngest -n uvicorn -c "$PROJECT_ROOT"
# PARSER_TIER0 forwarding removed 2026-09-07: its only reader was
# SimpleWorkflow2ParsePDF2Markdown.pdf_processor._scrub_env, retired with the
# legacy parser entry point. InngestParsingToS3BucketPipeline/parse_document.py
# mentions the name in a docstring only.
# Forward EMBEDDINGS_BACKEND (ollama|runpod) only when the operator set it, so
# the uvicorn worker (which builds the P4 embedder via get_embedder()) uses the
# chosen backend. Injected conditionally — an empty value would be read as a
# non-default '' and crash the factory, so we omit it when unset and let .env /
# the 'ollama' default apply.
EMB_PREFIX=""
if [ -n "${EMBEDDINGS_BACKEND:-}" ]; then
    EMB_PREFIX="EMBEDDINGS_BACKEND='${EMBEDDINGS_BACKEND}' "
    echo "==> forwarding EMBEDDINGS_BACKEND=${EMBEDDINGS_BACKEND} to uvicorn worker"
fi
tmux send-keys -t inngest:uvicorn \
    "${EMB_PREFIX}INNGEST_DEV=1 INNGEST_BASE_URL=http://localhost:8290 uv run uvicorn inngest_pipelines.server:app --port 8000 2>&1 | tee '$UVICORN_LOG'" C-m

tmux new-window -t inngest -n inngest-cli -c "$PROJECT_ROOT"
tmux send-keys -t inngest:inngest-cli \
    "sleep 6 && npx --yes inngest-cli@latest dev --port 8290 -u http://127.0.0.1:8000/api/inngest --no-discovery 2>&1 | tee '$INNGEST_LOG'" C-m

# 4) poll
echo "==> waiting for endpoints to come up (max 60s)..."
ok=0
for i in $(seq 1 60); do
    uv_up=""
    ic_up=""
    curl -sf -m 1 http://127.0.0.1:8000/api/inngest >/dev/null 2>&1 && uv_up=1
    curl -sf -m 1 http://127.0.0.1:8290 >/dev/null 2>&1 && ic_up=1
    if [ -n "$uv_up" ] && [ -n "$ic_up" ]; then
        echo "==> both endpoints up after ${i}s"
        ok=1
        break
    fi
    sleep 1
done

if [ "$ok" = 1 ]; then
    echo
    echo "==> READY"
    echo "    Inngest UI:    http://localhost:8290"
    echo "    uvicorn log:   $UVICORN_LOG"
    echo "    inngest log:   $INNGEST_LOG"
    echo "    tmux attach:   tmux attach -t inngest"
    echo
    echo "    Trigger run:   curl -X POST http://localhost:8290/e/key -H 'Content-Type: application/json' \\"
    echo "                     -d '{\"name\":\"pipeline/run\",\"data\":{}}'"
    echo "    Status:        ./scripts/status_pipeline.sh"
    echo "    Cancel:        ./scripts/cancel_pipeline.sh <run_id>"
    echo "    Stop all:      ./scripts/stop_pipeline.sh"
else
    echo "==> TIMEOUT — services did not come up within 60s"
    echo "    tmux capture-pane -t inngest:uvicorn -p | tail -30"
    echo "    tmux capture-pane -t inngest:inngest-cli -p | tail -30"
    exit 1
fi
