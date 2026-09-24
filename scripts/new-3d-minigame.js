#!/usr/bin/env node
// ============================================================
// NEW 3D MINIGAME — scaffold a stage game in one command.
//
//   node scripts/new-3d-minigame.js <key> "<TITLE>" [options]
//
//   <key>        lowercase letters/digits, the registry key (e.g. crateclash)
//   "<TITLE>"    the name on the opening card (e.g. "CRATE CLASH")
//
//   --set=ind            STAGE_SETS key for the scenery (ind, fin, fae, shop, hub, ...)
//   --place="..."        the opening card's location line
//   --icon=🎯            the arcade icon
//   --genre=push         MG_PROFILE genre: push | race | aim | brain | scramble | nerve | rhythm
//   --control=thumb      thumb | tap | dual
//   --hold=faceoff       faceoff | sideon — the registered hold. The template is written
//                        for faceoff; a sideon game switches to hold:'side', sideHud and
//                        touch({ split: 'x' }) (see HighNoon.js, BlockParty.js)
//   --desc="..."         the how-to-play text on the intro card
//   --dry-run            print what would change, write nothing
//
// It writes:
//   src/minigames/<Name>.js   from src/minigames/_template3d.js (playable as is)
//   qa/<key>.js               a probe on qa/stageprobe.js
// and registers the game in:
//   src/config/MinigameRegistry.js   MG_TYPES, MG_INFO, MG_NET, MG_SHAPE,
//                                    MG_ORIENTATION_MAP, MG_PROFILE
//   src/minigames/MinigameManager.js MG_MODULES (lazy import)
//
// Then follow docs/MINIGAME_3D_PLAYBOOK.md from step 3. The game starts as the
// template's coin scramble: face-off hold, 2 seats, offline only (MG_NET
// 'local', wire 'snapshot', live false). Change those entries when the game
// supports more.
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : true];
}));
const [key, title] = args.filter(a => !a.startsWith('--'));
const DRY = !!opt['dry-run'];

function die(msg) { console.error('✗ ' + msg); process.exit(1); }
if (!key || !title) die('usage: node scripts/new-3d-minigame.js <key> "<TITLE>" [--set=ind] [--icon=🎯] [--dry-run]');
if (!/^[a-z][a-z0-9]{2,20}$/.test(key)) die(`key "${key}" must be 3–21 lowercase letters/digits, starting with a letter`);

const Name = title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join('') || key[0].toUpperCase() + key.slice(1);
const set = opt.set || 'ind';
const place = (opt.place || 'THE CITY').toUpperCase();
const icon = opt.icon || '🎮';
const genre = opt.genre || 'push';
const control = opt.control || 'thumb';
const hold = opt.hold || 'faceoff';
if (!['faceoff', 'sideon'].includes(hold)) die(`--hold must be faceoff or sideon`);
const desc = opt.desc || `Lay the phone flat between you. DRAG on your half to run and grab the coins that drop into the yard. Most coins when the whistle blows wins!`;
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const P = {
    tpl: path.join(ROOT, 'src/minigames/_template3d.js'),
    game: path.join(ROOT, `src/minigames/${Name}.js`),
    probe: path.join(ROOT, `qa/${key}.js`),
    reg: path.join(ROOT, 'src/config/MinigameRegistry.js'),
    mgr: path.join(ROOT, 'src/minigames/MinigameManager.js'),
    sets: path.join(ROOT, 'src/engine/StageSets.js'),
};

// ---- Refuse anything that would clobber or collide -------------------------
const reg = fs.readFileSync(P.reg, 'utf8');
const mgr = fs.readFileSync(P.mgr, 'utf8');
if (new RegExp(`^\\s*'${key}',`, 'm').test(reg)) die(`"${key}" is already in MG_TYPES`);
if (new RegExp(`^\\s*${key}\\s*:`, 'm').test(mgr)) die(`"${key}" is already in MG_MODULES`);
if (fs.existsSync(P.game)) die(`${path.relative(ROOT, P.game)} already exists`);
if (fs.existsSync(P.probe)) die(`${path.relative(ROOT, P.probe)} already exists`);
const setsSrc = fs.readFileSync(P.sets, 'utf8');
if (!new RegExp(`\\b${set}\\s*[:(]`).test(setsSrc)) console.warn(`! STAGE_SETS may not have "${set}" — the game will run with a bare floor until it does`);

// ---- Registry edits ----------------------------------------------------------
// Insert `line` as the last entry of `export const NAME = { ... };` (or [ ... ];).
function appendTo(src, name, line) {
    const head = new RegExp(`export const ${name} = ([\\[{])`);
    const m = head.exec(src);
    if (!m) die(`could not find ${name}`);
    const close = m[1] === '[' ? '\n];' : '\n};';
    const end = src.indexOf(close, m.index);
    if (end < 0) die(`could not find the end of ${name}`);
    return src.slice(0, end) + '\n' + line + src.slice(end);
}
let r = reg;
r = appendTo(r, 'MG_TYPES', `    '${key}',`);
r = appendTo(r, 'MG_INFO', `    ${key}: { icon: '${esc(icon)}', title: '${esc(title.toUpperCase())}', desc: '${esc(desc)}' },`);
r = appendTo(r, 'MG_NET', `    ${key}: 'local',`);
r = appendTo(r, 'MG_SHAPE', `    ${key}: 'arena',`);
r = appendTo(r, 'MG_ORIENTATION_MAP', `    ${key}: '${hold}',`);
r = appendTo(r, 'MG_PROFILE', `    ${key}: { genre: '${genre}', control: '${control}', wire: 'snapshot', seats: [2, 2], live: false },`);

let g = mgr;
{
    const m = /(const|let|export const) MG_MODULES = \{/.exec(g);
    if (!m) die('could not find MG_MODULES in MinigameManager.js');
    const end = g.indexOf('\n};', m.index);
    g = g.slice(0, end) + `\n    ${key}: () => import('./${Name}.js'),` + g.slice(end);
}

// ---- The game and its probe --------------------------------------------------
const game = fs.readFileSync(P.tpl, 'utf8')
    .replace(/__TITLE__/g, title.toUpperCase())
    .replace(/__SET__/g, set)
    .replace(/__PLACE__/g, place)
    .replace(/__KEY__/g, key)
    .replace('(Built from src/minigames/_template3d.js.)', `(Scaffolded ${new Date().toISOString().slice(0, 10)} from _template3d.js.)`);

const probe = `// ============================================================
// ${title.toUpperCase()} — probe (scaffolded; extend it as the rules change).
//   1. The stage builds in the face-off hold.
//   2. A real drag on the bottom half moves P1.
//   3. A pickup scores for the figure that reaches it.
//   4. A hard bot beats an idle player; the result reports once; no errors.
// usage: node ${key}.js          (screenshots: qa/shot-${key}-*.png)
// ============================================================
require('./stageprobe').run('${key}', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('stage built, face-off hold is not turned', s.gl && !s.turned);
    await waitPhase('play');

    const from = (await state()).pos[0];
    await page.mouse.move(206, 780); await page.mouse.down();
    await page.mouse.move(206, 700, { steps: 4 });
    await page.waitForTimeout(700);
    await page.mouse.up();
    s = await state();
    ok('a drag on the bottom half moves P1', Math.hypot(s.pos[0][0] - from[0], s.pos[0][1] - from[1]) > 0.3, \`\${from} → \${s.pos[0]}\`);
    await shot('play');

    const before = s.score[0];
    await page.evaluate(([x, z]) => window.__G._debugCoinAt(x, z), s.pos[0]);
    await page.waitForTimeout(400);
    s = await state();
    ok('a coin under P1 scores for P1', s.score[0] === before + 1, \`\${before} → \${s.score[0]}\`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(120000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? \`winner=\${r.winner} in \${(r.ms / 1000).toFixed(1)}s\` : 'timed out');
    await cleanup();
});
`;

// ---- Write, or say what would be written ------------------------------------
const plan = [
    [P.game, game, 'new'], [P.probe, probe, 'new'],
    [P.reg, r, 'MG_TYPES, MG_INFO, MG_NET, MG_SHAPE, MG_ORIENTATION_MAP, MG_PROFILE'],
    [P.mgr, g, 'MG_MODULES'],
];
for (const [file, text, what] of plan) {
    console.log(`${DRY ? '·' : '✓'} ${path.relative(ROOT, file)}  (${what})`);
    if (!DRY) fs.writeFileSync(file, text);
}
if (DRY) { console.log('\n--dry-run: nothing written.'); process.exit(0); }
console.log(`
Next (docs/MINIGAME_3D_PLAYBOOK.md):
  1. bash qa/parsecheck.sh src
  2. Serve the repo and play it: Arcade → ${title.toUpperCase()}
  3. node qa/${key}.js      (needs the server on :8129)
  4. Replace the coin rules with yours, keeping the skeleton; update the probe.`);
