// ============================================================
// THE THREE SURFACES, HELD TO A HAND-WRITTEN EXPECTATION
//
// `surfacesOf()` derives where a game can be played from four authored
// properties. Deriving beats three hand-kept lists — but a derivation is only
// as good as its inputs, and a wrong `control` or `seats` on one game shows up
// at runtime as a minigame nobody in the room can start, four turns into a
// match, with no error anywhere.
//
// So the expectation below is written out by hand, from the audit in
// docs/MINIGAME_LIBRARY_PLAN.md, and this probe checks the derivation against
// it. When the two disagree one of them is wrong and the disagreement is the
// point: either a property was mistyped, or the audit changed and nobody said.
//
// No browser. The registry is pure data.
//
// usage: node surfaces.js
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

// THE EXPECTATION. [ shared 3-4?, device, online? ]
// Every game is playable at two on one phone, so that column is not repeated.
//
// The 3-4 column is now a statement about the CODE, not about the mechanic: it
// is true only for games converted to N slots (MG_PROFILE.live). A game that
// could support four in principle and still has two hard-coded halves is false
// here, because four people cannot play it. Converting one flips it, and this
// list is where that gets noticed.
const EXPECT = {
    quickdraw:    [true,  'any',    true ],
    sortrush:     [true,  'any',    true ],
    snapstrike:   [true,  'any',    true ],
    steadyhand:   [true,  'tablet', true ],
    rhythmforge: [false, null,     false],
    freeze:       [false, null,     true ],
    meteordodge:  [true,  'tablet', true ],
    lootcatch:    [true,  'tablet', true ],
    treeclimb:    [true,  'tablet', true ],
    tankclash:   [false, null,     true ],   // dual controls, but great online
    penalty:     [false, null,     false],
    clearout:     [false, null,     true ],
    orbdeflect:  [false, null,     false],
    sumospheres:  [false, null,     true ],
    lightcycles:  [false, null,     true ],
    puck:        [false, null,     false],
    bombpass:    [false, null,     false],
    grandprix:    [false, null,     true ],
    memorymatch: [false, null,     false],
    fourinarow:  [false, null,     false],
    gridrecall:   [false, null,     true ],
    oddoneout:    [true,  'tablet', true ],
};

// The headline counts from the plan. If a property changes and one of these
// moves, the plan is out of date and should be updated deliberately.
const EXPECT_PHONE_MANY = 3;    // LIVE games — converted to N slots
const EXPECT_TABLET_MANY = 8;   // ...plus Odd One Out and Steady Hand, which declare `roomy`
const EXPECT_ONLINE = 15;       // possible across devices
const EXPECT_ONLINE_NOW = 6;    // running across devices today

function asModule(file) {
    const tmp = path.join(os.tmpdir(), `_qa_surf_${Date.now()}.mjs`);
    fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'src', 'config', file), 'utf8'));
    return tmp;
}

(async () => {
    const R = await import('file://' + asModule('MinigameRegistry.js'));

    // ---- the profile covers the roster, and nothing else -------------------
    const missing = R.MG_TYPES.filter(t => !R.MG_PROFILE[t]);
    ok('every game in the roster has a profile', missing.length === 0, missing.join(', '));
    const stray = Object.keys(R.MG_PROFILE).filter(t => !R.MG_TYPES.includes(t));
    ok('...and nothing is profiled that is not in the roster', stray.length === 0, stray.join(', '));

    const badGenre = R.MG_TYPES.filter(t => !R.MG_GENRES[R.MG_PROFILE[t].genre]);
    ok('every genre is a real one', badGenre.length === 0, badGenre.join(', '));
    const badWire = R.MG_TYPES.filter(t => !R.MG_WIRE_ORDER.includes(R.MG_PROFILE[t].wire));
    ok('every wire tier is a real one', badWire.length === 0, badWire.join(', '));
    const badCtl = R.MG_TYPES.filter(t => !['tap', 'thumb', 'dual'].includes(R.MG_PROFILE[t].control));
    ok('every control profile is a real one', badCtl.length === 0, badCtl.join(', '));
    const badSeats = R.MG_TYPES.filter(t => {
        const s = R.MG_PROFILE[t].seats;
        return !Array.isArray(s) || s.length !== 2 || s[0] < 2 || s[1] < s[0] || s[1] > 4;
    });
    ok('every seat range is 2..4 and the right way round', badSeats.length === 0, badSeats.join(', '));

    // ---- the derivation matches the audit ----------------------------------
    const wrong = [];
    R.MG_TYPES.forEach(t => {
        const s = R.surfacesOf(t);
        const e = EXPECT[t];
        if (!e) { wrong.push(`${t}: no expectation`); return; }
        if (s.sharedTwo !== true)   wrong.push(`${t}: 2P should always be true`);
        if (s.sharedMany !== e[0])  wrong.push(`${t}: 3-4P ${s.sharedMany}, expected ${e[0]}`);
        if (s.manyDevice !== e[1])  wrong.push(`${t}: device ${s.manyDevice}, expected ${e[1]}`);
        if (s.online !== e[2])      wrong.push(`${t}: online ${s.online}, expected ${e[2]}`);
    });
    ok('the derivation agrees with the hand-written audit, game for game',
       wrong.length === 0, wrong.slice(0, 5).join(' | '));

    // ---- the counts the plan is argued from --------------------------------
    const many   = R.MG_TYPES.filter(t => R.surfacesOf(t).sharedMany);
    const phone  = many.filter(t => R.surfacesOf(t).manyDevice === 'any');
    const online = R.MG_TYPES.filter(t => R.surfacesOf(t).online);
    const now    = R.MG_TYPES.filter(t => R.surfacesOf(t).onlineNow);

    ok('every game is playable by two on one phone',
       R.typesForSurface('two').length === R.MG_TYPES.length, `${R.typesForSurface('two').length}/22`);
    ok(`a phone seats 3-4 for ${EXPECT_PHONE_MANY} games`,
       phone.length === EXPECT_PHONE_MANY, `${phone.length}: ${phone.join(', ')}`);
    ok(`a tablet seats 3-4 for ${EXPECT_TABLET_MANY}`,
       many.length === EXPECT_TABLET_MANY, `${many.length}`);
    ok(`${EXPECT_ONLINE} games can be played across devices`,
       online.length === EXPECT_ONLINE, `${online.length}`);
    ok(`...of which ${EXPECT_ONLINE_NOW} run today`,
       now.length === EXPECT_ONLINE_NOW, `${now.length}: ${now.join(', ')}`);

    // A tablet is required for exactly the games that say they need the room.
    const tabletOnly = many.filter(t => R.surfacesOf(t).manyDevice === 'tablet');
    const roomless = tabletOnly.filter(t => !R.MG_PROFILE[t].roomy);
    ok('a tablet is required for exactly the games that declare they need it',
       roomless.length === 0, roomless.join(', '));

    // ---- the registries still agree with each other ------------------------
    // MG_NET said which games cross the wire before MG_PROFILE existed. The two
    // must not disagree: a 'parallel' game is one that needs nothing on the
    // wire, which is wire 'none'.
    const netMismatch = R.MG_TYPES.filter(t =>
        (R.MG_NET[t] === 'parallel') !== (R.MG_PROFILE[t].wire === 'none'));
    ok('MG_NET and the wire tier say the same thing', netMismatch.length === 0, netMismatch.join(', '));

    // ---- a reason for every refusal ----------------------------------------
    const noReason = [];
    R.MG_TYPES.forEach(t => {
        const s = R.surfacesOf(t);
        if (!s.sharedMany && !R.blockedReason(t, 'many'))   noReason.push(`${t}/many`);
        if (!s.online     && !R.blockedReason(t, 'online')) noReason.push(`${t}/online`);
    });
    ok('every game that cannot play a surface says why', noReason.length === 0, noReason.join(', '));

    // ---- the genre spread --------------------------------------------------
    const byGenre = {};
    Object.keys(R.MG_GENRES).forEach(g => { byGenre[g] = R.MG_TYPES.filter(t => R.MG_PROFILE[t].genre === g).length; });
    const total = Object.values(byGenre).reduce((a, b) => a + b, 0);
    ok('every genre has at least one game, and they add up',
       total === R.MG_TYPES.length && Object.values(byGenre).every(n => n > 0),
       Object.entries(byGenre).map(([g, n]) => `${g} ${n}`).join(' · '));

    console.log('=== THE THREE SURFACES ===');
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
