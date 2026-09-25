// ============================================================
// RED LIGHT, GREEN LIGHT — the fountain park, face-off hold.
//   1. Built, not turned.
//   2. Holding P1's half on green runs P1 toward the light; letting go stops.
//   3. Still moving on red (past the grace) is caught: back to the start.
//   4. Standing still on red is safe.
//   5. Reaching the stop line wins.
//   6. A hard bot beats an idle player; nothing leaks; no errors.
// usage: node redlight.js          (screenshots: qa/shot-redlight-*.png)
// ============================================================
require('./stageprobe').run('redlight', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('the course is built, face-off hold not turned', s.gl && !s.turned);
    await waitPhase('play');

    await G('_debugLight', 'green', 99);
    const z0 = (await state()).runners[0].z;
    await page.mouse.move(206, 760); await page.mouse.down();
    await page.waitForTimeout(1000);
    const mid = await state();
    await shot('run');
    await page.mouse.up();
    await page.waitForTimeout(600);
    const a = await state();
    await page.waitForTimeout(500);
    const b = await state();
    ok('holding on green runs P1 toward the light', mid.runners[0].z < z0 - 0.5, `${z0} → ${mid.runners[0].z}`);
    ok('letting go stops P1', b.runners[0].v === 0 && Math.abs(b.runners[0].z - a.runners[0].z) < 0.05, `v ${b.runners[0].v}`);

    // Keep running into a red.
    await page.mouse.move(206, 760); await page.mouse.down();
    await page.waitForTimeout(400);
    await G('_debugLight', 'red', 99);
    s = await (async () => { for (let i = 0; i < 60; i++) { const st = await state(); if (st.runners[0].caught) return st; await page.waitForTimeout(80); } return state(); })();
    await page.mouse.up();
    ok('still moving on red is caught', s.runners[0].caught === 1, JSON.stringify(s.runners[0]));
    await shot('caught');
    await page.waitForTimeout(1500);
    s = await state();
    ok('…and sent back to the start', Math.abs(s.runners[0].z - 10.5) < 0.2, `z ${s.runners[0].z}`);

    // Standing still on red is safe.
    await G('_debugPlace', 0, 6);
    await G('_debugLight', 'red', 99);
    await page.waitForTimeout(1200);
    s = await state();
    ok('standing still on red is safe', Math.abs(s.runners[0].z - 6) < 0.01 && s.runners[0].back === 0, JSON.stringify(s.runners[0]));

    // The finish.
    await G('_debugLight', 'green', 99);
    await G('_debugPlace', 0, 2.2);
    await page.mouse.move(206, 760); await page.mouse.down();
    s = await (async () => { for (let i = 0; i < 60; i++) { const st = await state(); if (st.winner >= 0) return st; await page.waitForTimeout(80); } return state(); })();
    await page.mouse.up();
    ok('reaching the stop line wins', s.winner === 0, `winner ${s.winner}`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(180000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
