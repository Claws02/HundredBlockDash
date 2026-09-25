// ============================================================
// SUMO SPHERES — glass balls on the crumbling ring (2 seats here; 3 and 4
// seats are covered through the real ready gate by qa/livegames.js).
//   1. Built in the face-off hold, one shared camera.
//   2. A real drag in P1's zone rolls P1's ball that way.
//   3. A collision with momentum knocks the other ball away.
//   4. From 22 s the ring shrinks and its outer tiles crumble away.
//   5. Over the edge is out; the last one in wins.
//   6. A hard bot beats an idle player; no leaks, no errors.
// usage: node sumospheres.js          (screenshots: qa/shot-sumospheres-*.png)
// ============================================================
require('./stageprobe').run('sumospheres', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 8000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(40); }
        return state();
    };
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('built in the face-off hold', s.gl && !s.turned && s.n === 2 && s.tiles > 50, `tiles ${s.tiles}`);
    await waitPhase('play', 30000);
    await shot('play');

    const x0 = (await state()).balls[0].x;
    await page.mouse.move(206, 700); await page.mouse.down();
    await page.mouse.move(256, 700, { steps: 3 });
    await page.waitForTimeout(900);
    s = await state();
    await page.mouse.up();
    ok('a real drag in P1\'s zone rolls P1\'s ball that way', s.balls[0].x > x0 + 0.5, `x ${x0} → ${s.balls[0].x}`);

    await G('_debugPlace', 0, -3.2, 0, 0.35, 0, 5);
    await G('_debugPlace', 1, 0, 0, 0, 0, 0);
    s = await waitFor(st => st.balls[1].vx > 0.1, 3000);
    await shot('hit');
    ok('a hit with momentum knocks the other ball away', s.balls[1].vx > 0.1, `P2 vx ${s.balls[1].vx}`);

    await G('_debugPlace', 0, 0, 3, 0, 0, 0);
    await G('_debugPlace', 1, 0, -3, 0, 0, 0);
    await G('_debugClock', 30);
    await page.waitForTimeout(900);
    s = await state();
    await shot('crumble');
    ok('from 22 s the ring shrinks and its outer tiles crumble', s.radius < 10 && s.fallen > 10, `radius ${s.radius} fallen ${s.fallen}/${s.tiles}`);

    await G('_debugPlace', 1, 0, -(s.radius - 0.2), 0, -0.4, 0);
    s = await waitFor(st => st.balls[1].out, 3000);
    ok('over the edge is out', s.balls[1].out && !s.balls[0].out);
    const r0 = await waitResult(20000, async () => {
        const st = await state();
        if (st && st.phase === 'over') await shot('verdict');
    });
    ok('the last one in wins', !!r0 && r0.winner === 0, r0 ? `winner ${r0.winner}` : 'no result');

    await launch({ bot: true, skill: 0.85 });
    const r = await waitResult(120000);
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
