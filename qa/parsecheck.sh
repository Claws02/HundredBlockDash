#!/bin/bash
# `node --check` parses as CommonJS and silently tolerates things that are
# invalid in a module (it missed a dangling `else`). Copy to .mjs so Node parses
# each file as the ES module it actually is.
fail=0
for f in $(find "$1" -name '*.js'); do
  cp "$f" /tmp/_pc.mjs
  if ! node --check /tmp/_pc.mjs 2>/tmp/_pc.err; then
    echo "PARSE FAIL: $f"; head -4 /tmp/_pc.err; fail=1
  fi
done
rm -f /tmp/_pc.mjs /tmp/_pc.err
[ $fail -eq 0 ] && echo "module parse sweep clean"
exit $fail
