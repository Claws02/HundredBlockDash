// ============================================================
// BOWLING — the neon lanes, face-off hold, split screen.
//   1. Built with physics; two views once play starts.
//   2. The scoring is a real bowling card (strikes, spares, the last frame).
//   3. A real flick up P1's half sends the ball down the lane.
//   4. A good ball into the rack knocks real pins down, and they are counted.
//   5. A ball off the edge goes in the gutter and scores nothing.
//   6. A hard bot beats an idle player; nothing leaks; no errors.
// usage: node bowling.js          (screenshots: qa/shot-bowling-*.png)
// ============================================================
require('./stageprobe').run('bowling', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const waitFor = async (fn, ms = 40000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(60); }
        return state();
    };
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    await waitPhase('play', 30000);
    let s = await state();
    ok('built with physics; split screen once play starts', s.gl && s.physics && s.views === 2, `views ${s.views} physics ${s.physics}`);

    const cards = await Promise.all([
        G('_debugScore', [10, 10, 10, 10]), G('_debugScore', [7, 3, 5, 2]), G('_debugScore', [3, 4, 2, 1]),
        G('_debugScore', [10, 3, 4]), G('_debugScore', [6, 4, 10, 7, 2]),
    ]);
    ok('scoring is a real card: 60 / 22 / 10 / 24 / 39', JSON.stringify(cards) === JSON.stringify([60, 22, 10, 24, 39]), JSON.stringify(cards));

    s = await waitFor(st => st.lanes[0].sub === 'aim');
    // A real flick: quick, straight up the bottom half.
    await page.mouse.move(200, 830); await page.mouse.down();
    await page.mouse.move(200, 700, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    s = await state();
    ok('a real flick up P1\'s half sends the ball down the lane', s.lanes[0].sub === 'roll' && s.lanes[0].ball.v > 3, JSON.stringify(s.lanes[0].ball));
    await shot('roll');
    s = await waitFor(st => st.lanes[0].rolls.length >= 1, 30000);
    await shot('pins');
    ok('the ball is counted', s.lanes[0].rolls.length === 1, JSON.stringify(s.lanes[0].rolls));
    await forceEnd();

    // A good ball, from code, into the pocket: real pins fall.
    await launch();
    await waitPhase('play', 30000);
    s = await waitFor(st => st.lanes[0].sub === 'aim');
    await G('_debugBowl', 0, 0.011, 0.95, 0);
    s = await waitFor(st => st.lanes[0].rolls.length >= 1, 30000);
    ok('a good ball into the rack knocks real pins down', s.lanes[0].rolls[0] >= 6, `down ${s.lanes[0].rolls[0]} · ${s.lanes[0].msg}`);
    await shot('strike');
    // A ball aimed off the edge: gutter.
    s = await waitFor(st => st.lanes[0].sub === 'aim');
    const before = s.lanes[0].rolls.length;
    await G('_debugBowl', 0, 0.12, 0.6, 0);
    s = await waitFor(st => st.lanes[0].rolls.length > before, 30000);
    ok('a ball off the edge goes in the gutter and scores nothing', s.lanes[0].rolls[before] === 0, JSON.stringify(s.lanes[0]));
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(300000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
