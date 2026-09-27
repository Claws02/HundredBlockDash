#!/usr/bin/env bash
# The gates for a change, in order, stopping at the first red:
#   parsecheck (1 s) → each named probe → surfaces (registry audit).
# usage: check.sh <key> [key …]     key = the probe name in qa/ (e.g. blockparty, barrage, kartgp)
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT" || exit 1
bash "$(dirname "$0")/dev.sh" >/dev/null || exit 1
echo "── parsecheck"; bash qa/parsecheck.sh src | tail -3 | grep -q "sweep clean" || { bash qa/parsecheck.sh src | tail -8; echo "✗ parsecheck"; exit 1; }
echo "   ✓ clean"
status=0
for key in "$@"; do
  f="qa/$key.js"; [ -f "$f" ] || { echo "✗ no probe $f (see: ls qa/*.js)"; status=1; continue; }
  echo "── $f"
  out="$(cd qa && timeout 1500 node "$key.js" 2>&1)"; code=$?
  echo "$out" | grep -E "✓|✗|Error|error" | sed 's/^/   /' | cut -c1-240
  [ $code -eq 0 ] || { status=1; echo "   ✗ $key exited $code"; }
done
echo "── surfaces"; node qa/surfaces.js 2>&1 | tail -1
exit $status
