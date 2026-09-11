#!/usr/bin/env bash
# stop_pipeline.sh — teardown of the :8000 / :8290 stack:
#   1. Kill tmux session
#   2. Belt-and-suspenders kill of port listeners
#   3. Verify ports 8000/8290 free
#
# The graceful `pipeline/cancel` step was removed on 2026-09-07 with the
# pipeline-run function. No surviving function subscribes to that event, so the
# POST always succeeded and the script then slept PIPELINE_STOP_GRACE_SECS (30s)
# for nothing -- on every automated bounce, and this script is called by
# campaign_watch.sh:812 and watchdog_graph_rebuild.sh:362. The live functions are
# cancelled by their own events (graph/rebuild.cancel, sample/parse-upload.cancel)
# via their own scripts.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# 1) kill tmux session
if tmux has-session -t inngest 2>/dev/null; then
    echo "==> killing tmux 'inngest' session"
    tmux kill-session -t inngest
fi

# 2) belt-and-suspenders port kill
sleep 1
for port in 8000 8290; do
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "==> force-killing port $port pids: $pids"
        # shellcheck disable=SC2086
        kill -9 $pids 2>/dev/null || true
    fi
done

# 3) verify
sleep 1
if lsof -ti :8000 >/dev/null 2>&1 || lsof -ti :8290 >/dev/null 2>&1; then
    echo "==> WARNING: port still busy"
    lsof -i :8000 -i :8290 2>/dev/null
    exit 1
fi
echo "==> ports free, pipeline stopped cleanly"
