// ============================================================
// TREE CLIMB — the 3D oaks, split screen, and solo across phones.
//   1. Built; two views once the climb is set.
//   2. A real tap on the side the leaf grew climbs and banks a coin; six in a row.
//   3. The leaves are not a metronome (runs of two happen over a long ladder).
//   4. The wrong side drops you to the last branch on THAT side; coins stay.
//   5. P2's taps are read from their end (their right is the stage's left).
//   6. Time up: highest wins, and the win callback carries payouts + standings.
//   7. Solo (across phones): one full-screen view, and the score is the coins.
//   8. A hard bot beats an idle player; no leaks, no errors.
// usage: node treeclimb.js          (screenshots: qa/shot-treeclimb-*.png)
// ============================================================
require('./stageprobe').run('treeclimb', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 8000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(50); }
        return state();
    };
    // P1 holds the bottom; P2 the top, from the far end.
    const tapSide = async (slot, side) => {
        const right = slot === 0 ? side > 0 : side < 0;
        await page.mouse.click(right ? 320 : 90, slot === 0 ? 700 : 190);
    };
    const climb = async slot => {
        const s = await waitFor(st => !st.climbers[slot].busy);
        const h = s.climbers[slot].height;
        await tapSide(slot, s.climbers[slot].pending);
        return waitFor(st => st.climbers[slot].height === h + 1 && !st.climbers[slot].busy);
    };

    // Launch by hand so the win callback's payouts and standings are kept.
    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const MM = await import('/src/minigames/MinigameManager.js');
        window.__RESULT = undefined;
        state.mgActive = true; state.mgType = 'treeclimb';
        state.players[0].isBot = false; state.players[1].isBot = false;
        document.getElementById('minigame-layer').style.display = 'flex';
        document.getElementById('splash').style.display = 'none';
        const mod = await MM.loadMinigame('treeclimb');
        window.__G = mod; window.__T0 = performance.now();
        mod.start(false, (w, pay, stand) => { window.__RESULT = { winner: w, pay, stand, ms: performance.now() - window.__T0 }; }, 0.55);
    });
    await page.waitForTimeout(900);
    await shot('intro');
    await waitPhase('climb', 30000);
    await page.evaluate(() => window.__G._debugClock(0));
    let s = await state();
    ok('split screen once the climb is set', s.gl && s.views === 2 && s.n === 2, `views ${s.views}`);

    s = await climb(0);
    ok('a tap on the side the leaf grew climbs and banks a coin', s.climbers[0].height === 1 && s.climbers[0].coins === 1, JSON.stringify(s.climbers[0]));
    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.__G._debugClock(0)); s = await climb(0); }
    ok('six in a row', s.climbers[0].height === 6 && s.climbers[0].coins === 6, `height ${s.climbers[0].height}`);
    await shot('climb');

    // Wrong side: predict the landing from the ladder.
    const c = s.climbers[0], wrong = -c.pending;
    let expect = 0;
    for (let i = c.height - 2; i >= 0; i--) if (c.branches[i] === wrong) { expect = i + 1; break; }
    await tapSide(0, wrong);
    await page.waitForTimeout(150);
    await shot('fall');
    s = await waitFor(st => !st.climbers[0].busy && st.climbers[0].falls === 1);
    ok('the wrong side drops you to the last branch on that side, coins kept',
       s.climbers[0].height === expect && s.climbers[0].coins === 6, `6 → ${s.climbers[0].height} (expected ${expect}), coins ${s.climbers[0].coins}`);

    // P2, from the far end.
    await page.evaluate(() => window.__G._debugClock(0));
    s = await climb(1);
    s = await climb(1);
    ok('P2\'s taps are read from their end', s.climbers[1].height === 2, `P2 height ${s.climbers[1].height}`);
    await shot('p2');

    // A long ladder is not a metronome.
    for (let i = 0; i < 14; i++) { await page.evaluate(() => window.__G._debugClock(0)); s = await climb(0); }
    const br = s.climbers[0].branches;
    let pairs = 0, triples = 0;
    for (let i = 1; i < br.length; i++) if (br[i] === br[i - 1]) pairs++;
    for (let i = 2; i < br.length; i++) if (br[i] === br[i - 1] && br[i] === br[i - 2]) triples++;
    ok('the leaves repeat sides sometimes, never three alike', pairs > 0 && triples === 0, `${br.length} branches, ${pairs} repeats, ${triples} triples`);

    await page.evaluate(() => window.__G._debugClock(29.6));
    s = await waitFor(st => st.phase === 'over', 5000);
    ok('time up ends the climb; the verdict is full-frame', s.phase === 'over' && s.views === 0, `phase ${s.phase} views ${s.views}`);
    await page.waitForTimeout(1200);
    await shot('verdict');
    const r = await waitResult(20000);
    ok('highest wins, and the result carries payouts and standings',
       !!r && r.winner === 0 && Array.isArray(r.pay) && r.pay[0] === s.climbers[0].coins && r.stand[0] === s.climbers[0].height && r.stand[1] === 2,
       JSON.stringify(r));

    // Solo, the way a phone plays it in an online round.
    const solo = await page.evaluate(async () => {
        const Solo = await import('/src/minigames/SoloArena.js');
        window.__SOLO = undefined;
        Solo.play('treeclimb', 12345, sc => { window.__SOLO = sc; });
        const MM = await import('/src/minigames/MinigameManager.js');
        window.__G = await MM.loadMinigame('treeclimb');
        return true;
    });
    await waitPhase('climb', 30000);
    await page.evaluate(() => window.__G._debugClock(0));
    s = await state();
    ok('solo is one full-screen view', s.n === 1 && s.views === 1, `n ${s.n} views ${s.views}`);
    for (let i = 0; i < 3; i++) {
        const st = await waitFor(x => !x.climbers[0].busy);
        const h = st.climbers[0].height;
        await page.mouse.click(st.climbers[0].pending > 0 ? 320 : 90, 450);
        s = await waitFor(x => x.climbers[0].height === h + 1 && !x.climbers[0].busy);
    }
    await shot('solo');
    ok('solo taps read the left and right of the whole screen', s.climbers[0].height === 3, `height ${s.climbers[0].height}`);
    await page.evaluate(() => window.__G._debugClock(29.8));
    const t0 = Date.now();
    let score;
    while (Date.now() - t0 < 10000) { score = await page.evaluate(() => window.__SOLO); if (score !== undefined) break; await page.waitForTimeout(100); }
    ok('solo reports the banked coins as its score', score === 3, `score ${score}`);
    // The caller (NetMinigame) resets solo mode once the score is in.
    await page.evaluate(async () => (await import('/src/minigames/SoloArena.js')).reset());

    await launch({ bot: true, skill: 0.85 });
    const rb = await waitResult(180000);
    ok('a hard bot beats an idle player', !!rb && rb.winner === 1, rb ? `winner=${rb.winner} in ${(rb.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
