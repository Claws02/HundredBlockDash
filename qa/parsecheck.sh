#!/bin/bash
# ============================================================
# Static gate for src/. Two phases, both of which exist because a real bug got
# through the thing that came before them.
#
#   1. MODULE PARSE. `node --check` parses a file as CommonJS and tolerates
#      things that are invalid in an ES module — it silently passed a dangling
#      `else` in GameController. Copying to .mjs makes Node parse each file as
#      what it actually is.
#
#   2. DEAD LOCAL REFERENCES. Deleting a private helper and missing one of its
#      call sites is invisible to any parser: `_reflectIfMirrored is not defined`
#      only surfaced 25 minutes into a full-match run. This codebase names every
#      file-local helper with a leading underscore, so every `_foo(` call must
#      have a matching definition (or import) in the same file. That convention
#      makes the check exact rather than heuristic.
#
# usage: ./parsecheck.sh ../src
# ============================================================
set -u
DIR="${1:-../src}"
fail=0

for f in $(find "$DIR" -name '*.js'); do
  cp "$f" /tmp/_pc.mjs
  if ! node --check /tmp/_pc.mjs 2>/tmp/_pc.err; then
    echo "PARSE FAIL: $f"; head -4 /tmp/_pc.err; fail=1
  fi
done
rm -f /tmp/_pc.mjs /tmp/_pc.err

node - "$DIR" <<'NODE'
const fs = require('fs'), path = require('path');
const root = process.argv[2];

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}

let bad = 0;
for (const file of walk(root)) {
  // The archive is kept for reference, not shipped.
  if (file.includes('/archived/')) continue;
  const src = fs.readFileSync(file, 'utf8');

  // Deliberately NO tokenizing. Two earlier versions of this check tried to
  // strip comments, strings and template literals first, and both mangled real
  // code — a flat backtick-to-backtick strip swallows everything between two
  // nested `${...}` templates, which made three live functions in Onboarding.js
  // look undefined. A regex tokenizer is the wrong tool and this check does not
  // need one.
  //
  // The failure being guarded against is narrow and specific: a file-private
  // helper whose definition was deleted while a call site survived. Every such
  // helper in this codebase is `_`-prefixed and defined in exactly one of three
  // shapes, so testing for those three shapes directly is both exact and
  // immune to whatever else is in the file.
  const isDefined = name =>
    new RegExp(`function\\s+${name}\\b`).test(src) ||      // function _foo() {}
    new RegExp(`\\b${name}\\s*=[^=]`).test(src)     ||      // const _foo = ... / _foo = ...
    new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*(?:=|from)`).test(src); // destructured / imported

  // Call sites are hunted in a copy with single-line comments removed, so prose
  // like "their own _finish() before calling" isn't read as a call. Only `//`
  // comments, and only where not preceded by a colon, so `https://` survives —
  // block comments and templates are left alone for the reason above.
  const scan = src.replace(/(^|[^:])\/\/.*$/gm, '$1');

  const seen = new Set();
  for (const m of scan.matchAll(/(^|[^.\w$])(_\w+)\s*\(/g)) {
    const name = m[2];
    if (seen.has(name)) continue;
    seen.add(name);
    if (isDefined(name)) continue;
    console.log(`DEAD REF: ${file} calls ${name}() with no definition in the file`);
    bad++;
  }
}
if (bad) process.exit(1);
NODE
[ $? -ne 0 ] && fail=1

# ============================================================
#   3. THE COMMAND BUS AGREES WITH ITSELF
#
# Every player decision is a NAME now (src/core/Commands.js): UI handlers call
# Commands.run('roll'), and GameController / UIManager / ModalManager register
# the implementations. The names are also the online wire protocol.
#
# Nothing in JavaScript connects the two. A renamed or deleted command is a
# console warning at the moment somebody presses the button — and on a client
# it is worse than that, because the press leaves as an intent and the failure
# happens on the HOST, where nobody is looking. Both directions are checked:
# a command invoked with no implementation, and an implementation nothing
# invokes (which is usually half of a rename).
# ============================================================
node - "$DIR" <<'NODE'
const fs = require('fs'), path = require('path');
const root = process.argv[2];
function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}
const invoked = new Map(), defined = new Map();
for (const file of walk(root)) {
  if (file.includes('/archived/')) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/Commands\.run\(\s*'([A-Za-z_]\w*)'/g)) {
    if (!invoked.has(m[1])) invoked.set(m[1], file);
  }
  for (const block of src.matchAll(/Commands\.define\(\{([\s\S]*?)\n\}\);/g)) {
    for (const k of block[1].matchAll(/^ {4}([A-Za-z_]\w*)\s*:/gm)) {
      if (defined.has(k[1])) {
        console.log(`DUPLICATE COMMAND: "${k[1]}" registered in both ${defined.get(k[1])} and ${file}` +
                    ` — whichever module body runs last silently wins`);
        process.exitCode = 1;
      }
      defined.set(k[1], file);
    }
  }
}
let bad = 0;
for (const [name, file] of invoked) {
  if (!defined.has(name)) { console.log(`UNKNOWN COMMAND: ${file} runs "${name}" with no implementation`); bad++; }
}
for (const [name, file] of defined) {
  if (!invoked.has(name)) { console.log(`ORPHAN COMMAND: ${file} implements "${name}" and nothing runs it`); bad++; }
}
if (bad) process.exitCode = 1;
NODE
[ $? -ne 0 ] && fail=1

# ============================================================
#   4. EVERY MIRRORED SCENE IS ROUTABLE
#
# A full-screen beat announces itself through Scenes.emit(). Online, the host
# forwards it: SHARED beats to everybody, OWNER beats to the ONE phone named by
# `seat` on the payload. An owner beat with no seat has nowhere to go, and an
# unclassified name is not forwarded at all.
#
# Both failures are silent, and both freeze a networked match: the player whose
# decision it is sits looking at a board with nothing to press. That has now
# happened three times — the result card with no seat, and twice a modal raised
# through a path that never announced it — so it is checked rather than
# remembered.
# ============================================================
node - "$DIR" <<'NODE'
const fs = require('fs'), path = require('path');
const root = process.argv[2];
function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}
const scenesFile = path.join(root, 'ui', 'Scenes.js');
if (!fs.existsSync(scenesFile)) process.exit(0);
const block = /SCENE_TIER = \{([\s\S]*?)\n\};/.exec(fs.readFileSync(scenesFile, 'utf8'));
const tier = {};
if (block) for (const m of block[1].matchAll(/^ {4}([A-Za-z]\w*):\s*TIER\.(\w+)/gm)) tier[m[1]] = m[2];

let bad = 0;
for (const file of walk(root)) {
  if (file.includes('/archived/') || file.endsWith('Scenes.js')) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/Scenes\.emit\('([A-Za-z]\w*)',\s*(\{[\s\S]*?\})\s*\)/g)) {
    const [, name, payload] = m;
    if (!tier[name]) {
      console.log(`UNCLASSIFIED SCENE: ${file} emits "${name}", absent from SCENE_TIER — it is never mirrored`);
      bad++;
    } else if (tier[name] === 'OWNER' && !/\bseat\b/.test(payload)) {
      console.log(`UNSEATED SCENE: ${file} emits owner scene "${name}" with no seat — it has no phone to go to`);
      bad++;
    }
  }
}
if (bad) process.exitCode = 1;
NODE
[ $? -ne 0 ] && fail=1

[ $fail -eq 0 ] && echo "static sweep clean (module parse + dead local refs + command bus + scene routing)"
exit $fail
