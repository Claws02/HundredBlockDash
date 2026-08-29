// ============================================================
// The layout laws, checked as arithmetic.
//
// Every other probe in here drives a browser, because every other claim in this
// repo is about something that happens at runtime. This one is not: the layout
// rules in docs/MINIGAME_RULEBOOK.md are a function of a play structure, a
// number of seats and a viewport, and src/config/MinigameLayout.js is that
// function. So this checks it directly — no server, no Chromium, one second.
//
// What it is actually defending is the sentence the rulebook is built on:
//
//   A PHONE HOLDS AT MOST TWO PRIVATE PLAYFIELDS.
//
// It is easy to agree with that and then quietly ship a four-way split anyway,
// because on a desktop browser window it looks fine. These assertions are the
// 412x892 phone saying no.
//
// usage: node layout.js
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = path.join(__dirname, '..', 'src', 'config');
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

// The modules are ES modules served without a build step; Node will only import
// them under an .mjs extension, so they are copied rather than rewritten.
function asModule(file) {
    const tmp = path.join(os.tmpdir(), `_qa_${Date.now()}_${file}`.replace(/\.js$/, '.mjs'));
    fs.writeFileSync(tmp, fs.readFileSync(path.join(SRC, file), 'utf8'));
    return tmp;
}

// The screens that matter: the QA phone every layout fault so far was found on,
// a small phone, and a tablet — which is the one that proves the rule is being
// MEASURED and not assumed, because the same split is legal there.
const PHONE  = [412, 892];
const SMALL  = [360, 780];
const TABLET = [820, 1180];

const overlaps = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b) =>
    a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const area = r => r.w * r.h;

(async () => {
    const L = await import('file://' + asModule('MinigameLayout.js'));
    const R = await import('file://' + asModule('MinigameRegistry.js'));
    const { SHAPES, CHROME, CONTEXTS } = L;

    // ── The chrome budget ───────────────────────────────────────────────────
    const inner = L.innerBox(...PHONE);
    ok('the status pill keeps its band at both ends',
       inner.y === CHROME.EDGE_RESERVE && inner.h === PHONE[1] - CHROME.EDGE_RESERVE * 2,
       JSON.stringify(inner));

    // ── Nothing lands on top of anything else ───────────────────────────────
    for (const shape of Object.values(SHAPES)) {
        for (const n of [2, 3, 4]) {
            const f = L.frameFor(shape, n, ...PHONE);
            if (!f.ok) continue;
            const rects = f.seats.map(s => s.rect);
            let clash = null;
            for (let i = 0; i < rects.length && !clash; i++)
                for (let j = i + 1; j < rects.length && !clash; j++)
                    if (overlaps(rects[i], rects[j])) clash = `${i}/${j}`;
            ok(`${shape} @${n}: no two seats occupy the same pixels`, !clash, clash || '');
            ok(`${shape} @${n}: every seat is inside the playable box`,
               rects.every(r => inside(r, f.inner)), '');
            if (f.shared) {
                const on = f.seats.filter(s => s.role !== 'play' && overlaps(s.rect, f.shared)).length;
                ok(`${shape} @${n}: nobody's controls sit on the shared playfield`, on === 0,
                   on ? `${on} seat band(s) overlap it` : '');
            }
            ok(`${shape} @${n}: seats read right-side up from where they sit`,
               f.seats.every(s => [0, 90, 180, 270].includes(s.rot)), '');
        }
    }

    // ── THE LAW ─────────────────────────────────────────────────────────────
    const s3 = L.frameFor(SHAPES.SPLIT, 3, ...PHONE);
    ok('a rectangle refuses a three-way split outright', !s3.ok, s3.why);

    const s4 = L.frameFor(SHAPES.SPLIT, 4, ...PHONE);
    ok('four private playfields do not fit on a phone', !s4.ok, s4.why);
    ok('...and the refusal names the size it worked out',
       /206x400/.test(s4.why), s4.why);

    const s4small = L.frameFor(SHAPES.SPLIT, 4, ...SMALL);
    ok('nor on a smaller one', !s4small.ok, s4small.why);

    const s4tab = L.frameFor(SHAPES.SPLIT, 4, ...TABLET);
    ok('but they DO fit on a tablet — the rule is measured, not assumed',
       s4tab.ok, s4tab.seats.map(s => `${s.rect.w}x${s.rect.h}`).join(' '));

    const s2 = L.frameFor(SHAPES.SPLIT, 2, ...PHONE);
    ok('the shipped two-way split is still legal', s2.ok,
       s2.seats.map(s => `${s.rect.w}x${s.rect.h}`).join(' '));
    ok('a race gets identical playfields on both sides (R5)',
       new Set(s2.seats.map(s => `${s.rect.w}x${s.rect.h}`)).size === 1, '');
    ok('the far half is rotated for the player reading it upside-down',
       s2.seats[0].rot === 0 && s2.seats[1].rot === 180, '');
    ok('four quarters on a tablet are identical too',
       new Set(s4tab.seats.map(s => `${s.rect.w}x${s.rect.h}`)).size === 1, '');

    // ── A third player is free in three of the four structures ──────────────
    for (const shape of [SHAPES.ARENA, SHAPES.TABLE, SHAPES.RELAY]) {
        const sizes = [2, 3, 4].map(n => {
            const f = L.frameFor(shape, n, ...PHONE);
            const r = f.shared || (f.seats.find(s => s.role === 'play') || {}).rect;
            return f.ok && r ? `${r.w}x${r.h}` : 'FAIL';
        });
        ok(`${shape}: a third and fourth player cost the playfield nothing`,
           new Set(sizes).size === 1 && sizes[0] !== 'FAIL', sizes.join(' / '));
    }

    // ── What a designer is allowed to build ─────────────────────────────────
    ok('at two on a phone, all four structures are open',
       L.shapesFor(2, ...PHONE).length === 4, L.shapesFor(2, ...PHONE).join(', '));
    ok('at three and four on a phone, everything but SPLIT',
       L.shapesFor(3, ...PHONE).join() === 'arena,table,relay' &&
       L.shapesFor(4, ...PHONE).join() === 'arena,table,relay',
       `${L.shapesFor(3, ...PHONE).join(', ')} | ${L.shapesFor(4, ...PHONE).join(', ')}`);
    ok('across phones every structure is open at every count, because nothing is divided',
       [2, 3, 4].every(n => L.shapesFor(n, ...PHONE, CONTEXTS.PHONES).length === 4), '');

    const solo = L.frameFor(SHAPES.SPLIT, 4, ...PHONE, { ctx: CONTEXTS.PHONES, active: 2 });
    ok('one phone draws one seat, at full size',
       solo.ok && solo.seats.length === 1 && solo.seats[0].seat === 2 &&
       area(solo.seats[0].rect) === area(solo.inner),
       `${solo.seats[0].rect.w}x${solo.seats[0].rect.h}`);

    // ── The pressure rail ───────────────────────────────────────────────────
    const rail = solo.rail;
    ok('the rail rides in the band the mirrored status strip vacates',
       rail && rail.box.y + rail.box.h <= CHROME.EDGE_RESERVE,
       rail ? JSON.stringify(rail.box) : 'no rail');
    ok('a playfield across phones is exactly as big as it is today',
       area(solo.seats[0].rect) === area(L.innerBox(...PHONE)), '');
    ok('three rival chips are still legible on a phone',
       rail && rail.readable && rail.chip.w >= 96, rail ? `${rail.chip.w}px each` : '');
    ok('a solo round has no rail to draw',
       L.frameFor(SHAPES.SPLIT, 1, ...PHONE, { ctx: CONTEXTS.PHONES, rivals: 0 }).rail === null, '');

    // ── The registry agrees with itself ─────────────────────────────────────
    const known = new Set(Object.values(SHAPES));
    const missing = R.MG_TYPES.filter(t => !R.MG_SHAPE[t]);
    ok('every game in the roster is classified', missing.length === 0, missing.join(', '));
    const bogus = R.MG_TYPES.filter(t => R.MG_SHAPE[t] && !known.has(R.MG_SHAPE[t]));
    ok('...and every classification is a real shape', bogus.length === 0, bogus.join(', '));
    const stray = Object.keys(R.MG_SHAPE).filter(t => !R.MG_TYPES.includes(t));
    ok('...and nothing is classified that is not in the roster', stray.length === 0, stray.join(', '));

    // The one that is worth a probe: MG_NET and MG_SHAPE are two statements of
    // the same fact, and if they ever disagree one of them is wrong.
    const wrongNet = R.MG_TYPES.filter(t => R.MG_NET[t] === 'parallel' && R.MG_SHAPE[t] !== 'split');
    ok('every game playable across phones is a SPLIT — no shared playfield is why',
       wrongNet.length === 0, wrongNet.join(', '));
    const wrongShared = R.MG_TYPES.filter(t => R.MG_SHAPE[t] !== 'split' && R.MG_NET[t] !== 'local');
    ok('every game with a shared playfield or a turn order stays local',
       wrongShared.length === 0, wrongShared.join(', '));

    const counts = {};
    Object.values(SHAPES).forEach(s => { counts[s] = R.shapeIs(s).length; });
    // Deliberately not a threshold on the counts: a probe that fails the day
    // the roster improves is a probe nobody keeps. What matters is that all four
    // structures are actually represented, and that the spread is printed so the
    // shape of the roster is a fact somebody can read rather than an impression.
    ok('all four structures are represented in the roster',
       Object.values(SHAPES).every(s => counts[s] > 0),
       Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '));

    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
