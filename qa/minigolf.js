// ============================================================
// MINI GOLF — one sideways view, both at once, holes from a pool of seven.
//   1. Built in the side hold (turned in portrait); ONE view of the course.
//   2. Both players putt AT THE SAME TIME with real drags, each on their own
//      half of the screen (P1 right, P2 left in landscape), on the one shared
//      course, and the ball goes away from the pull, down the hole.
//   2b. The balls knock into each other — a waiting ball too, at no stroke.
//   3. A slow ball over the cup drops in, and the time is recorded.
//   4. The loop: hard goes round, soft rolls back. The pond costs a stroke.
//   5. Bumpers bounce the ball back.
//   6. Fewest strokes wins; level on strokes, the faster time wins.
//   7. Every hole in the pool builds.
//   8. A hard bot beats an idle player; nothing leaks; no errors.
// usage: node minigolf.js          (screenshots: qa/shot-minigolf-*.png)
// ============================================================
require('./stageprobe').run('minigolf', async ({ page, ok, launch, state, shot, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const force = keys => page.evaluate(async k => { const M = await import('/src/minigames/MiniGolf.js'); M._debugForceHoles(k); }, keys);
    const waitFor = async (fn, ms = 40000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(60); }
        return state();
    };

    await force(['windmill', 'loop', 'bridge']);
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('built in the side hold, turned sideways in portrait', s.gl && s.turned);
    s = await waitFor(st => st.sub === 'play' && st.hole === 0, 30000);
    ok('one view of the course for both', s.views === 1, `views ${s.views}`);
    await page.waitForTimeout(1700);
    await shot('tee');

    // Both at once, each on their own half. Stage (lx, ly) sits at screen
    // (412 - ly, lx): landscape "left" (back from the flag) is the glass's UP,
    // P1's half the glass's bottom, P2's the top.
    const x0 = s.balls.map(b => b.x);
    await page.mouse.move(206, 700); await page.mouse.down(); await page.mouse.move(210, 630, { steps: 3 }); await page.mouse.up();
    await page.mouse.move(206, 300); await page.mouse.down(); await page.mouse.move(202, 230, { steps: 3 }); await page.mouse.up();
    await page.waitForTimeout(300);
    s = await state();
    await shot('both');
    ok('both players putt at the same time, down the same hole', s.balls.every((b, i) => b.x > x0[i] + 0.3) && s.strokes[0][0] === 1 && s.strokes[1][0] === 1,
       `x ${x0} → ${s.balls.map(b => b.x)} strokes ${s.strokes.map(x => x[0])}`);
    await waitFor(st => st.balls.every(b => b.state !== 'roll'), 15000);

    // Ball on ball: P1 rolls into P2's ball, which is sitting waiting to putt.
    await G('_debugBall', 1, -3, -2.0);
    const st1 = (await state()).strokes[1][0];
    await G('_debugBall', 0, -6, -2.0); await G('_debugShoot', 0, 1, 0, 0.6);
    s = await waitFor(st => st.balls[1].x > -2.6, 4000);
    await shot('collide');
    ok('the balls knock each other, and a knock costs no stroke', s.balls[1].x > -2.6 && s.strokes[1][0] === st1, `P2 ball x −3 → ${s.balls[1].x}, strokes ${st1} → ${s.strokes[1][0]}`);
    await waitFor(st => st.balls.every(b => b.state !== 'roll'), 10000);

    // Into the cup: both, so the hole ends and the time is on the card.
    await G('_debugBall', 0, 6.3, 0.8); await G('_debugShoot', 0, 1, 0, 0.12);
    await page.waitForTimeout(1200);
    await G('_debugBall', 1, 6.3, 0.8); await G('_debugShoot', 1, 1, 0, 0.12);
    s = await waitFor(st => st.balls.every(b => b.holed), 6000);
    ok('a slow ball over the cup drops in, and the time is recorded', s.balls.every(b => b.holed) && s.times.every(t => t[0] > 0), JSON.stringify(s.times));

    // Hole 2: the loop.
    s = await waitFor(st => st.hole === 1 && st.sub === 'play', 15000);
    await G('_debugBall', 0, -3, -2.1); await G('_debugShoot', 0, 1, 0, 0.95);
    let saw = false;
    for (let i = 0; i < 40; i++) { s = await state(); if (s.balls[0].loop) saw = true; if (saw && !s.balls[0].loop && s.balls[0].x > 1.6) break; await page.waitForTimeout(60); }
    await shot('loop');
    ok('the loop: hard enough goes round', saw && s.balls[0].x > 1.6, `x ${s.balls[0].x} loop seen ${saw}`);
    await waitFor(st => st.balls[0].state === 'aim', 8000);
    await G('_debugBall', 0, -3, -2.1); await G('_debugShoot', 0, 1, 0, 0.35);
    s = await waitFor(st => st.balls[0].state === 'aim', 8000);
    ok('the loop: too soft rolls back', s.balls[0].x < -1.4, `x ${s.balls[0].x}`);
    await forceEnd();

    await force(['bridge', 'pinball', 'windmill']);
    await launch();
    s = await waitFor(st => st.sub === 'play' && st.hole === 0, 30000);
    const before = s.strokes[0][0];
    await G('_debugBall', 0, -4, 1.3); await G('_debugShoot', 0, 1, 0, 0.5);
    s = await waitFor(st => st.strokes[0][0] >= before + 2 || st.balls[0].state === 'aim', 6000);
    await page.waitForTimeout(300);
    s = await state();
    ok('water costs a stroke and puts the ball back', s.strokes[0][0] === before + 2 && Math.abs(s.balls[0].x + 4) < 0.05, `strokes ${before} → ${s.strokes[0][0]}, x ${s.balls[0].x}`);
    await G('_debugScore', [[3, 2, 2], [2, 3, 2]], [[10, 8, 9], [12, 8, 9]]);
    let r = await waitResult(20000);
    ok('level on strokes, the faster total time wins', !!r && r.winner === 0, r ? `winner ${r.winner}` : 'no result');

    await force(['pinball']);
    await launch();
    s = await waitFor(st => st.sub === 'play' && st.hole === 0, 30000);
    await G('_debugBall', 0, -4.5, 0.2); await G('_debugShoot', 0, 1, 0, 0.6);
    let back = false;
    for (let i = 0; i < 30; i++) { s = await state(); if (s.balls[0].x < -4.6) back = true; if (back) break; await page.waitForTimeout(50); }
    await shot('pinball');
    ok('a bumper bounces the ball back', back, `x ${s.balls[0].x}`);
    await G('_debugScore', [[3], [2]], [[5], [20]]);
    r = await waitResult(20000);
    ok('fewest strokes wins, whatever the time', !!r && r.winner === 1, r ? `winner ${r.winner}` : 'no result');

    const pool = await page.evaluate(async () => (await import('/src/minigames/MiniGolf.js'))._debugPool());
    for (const key of pool) {
        await force([key]);
        await launch();
        s = await waitFor(st => st.sub === 'play' && st.hole === 0, 30000);
        await page.waitForTimeout(1800);
        await shot(`hole-${key}`);
        ok(`${key}: builds and plays`, s.holes[0] === key && s.balls.every(b => b.state === 'aim'), JSON.stringify(s.holes));
        await forceEnd();
    }
    await force(null);

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const rb = await waitResult(300000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!rb && rb.winner === 1, rb ? `winner=${rb.winner} in ${(rb.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
