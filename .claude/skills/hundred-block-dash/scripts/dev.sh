#!/usr/bin/env bash
# Start (or restart) the static server the probes expect on :8129, serving the repo root.
# Safe to run any time: if it's already answering, it does nothing.
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
PORT="${PORT:-8129}"
if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/" | grep -q 200; then
  echo "server up on :$PORT"; exit 0
fi
LOG="${TMPDIR:-/tmp}/hbd-server.log"
( cd "$ROOT" && setsid nohup npx --yes http-server -p "$PORT" -s -c-1 . > "$LOG" 2>&1 & )
for i in $(seq 1 30); do
  sleep 0.5
  curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/" | grep -q 200 && { echo "server started on :$PORT (log $LOG)"; exit 0; }
done
echo "server did not come up; see $LOG" >&2; exit 1
