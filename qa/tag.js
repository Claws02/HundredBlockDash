// ============================================================
// TAG, YOU'RE IT! — the playground, face-off hold.
//   1. Built, not turned; somebody is IT.
//   2. A real drag moves P1.
//   3. IT touching the runner passes it on, and the new IT is frozen.
//   4. A frozen player cannot move.
//   5. The roundabout carries whoever stands on it; the tunnel hides.
//   6. Whoever is IT at the whistle loses.
//   7. A hard bot beats an idle player; nothing leaks; no errors.
// usage: node tag.js          (screenshots: qa/shot-tag-*.png)
// ============================================================
require('./stageprobe').run('tag', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('the playground is built, face-off hold not turned; somebody is IT', s.gl && !s.turned && (s.it === 0 || s.it === 1));
    await waitPhase('play');

    await G('_debugIt', 1);
    await G('_debugPlace', 1, -3, -6.5);
    const f0 = (await state()).figs[0];
    await page.mouse.move(206, 780); await page.mouse.down();
    await page.mouse.move(150, 720, { steps: 4 });
    await page.waitForTimeout(700);
    s = await state();
    await page.mouse.up();
    ok('a real drag moves P1', Math.hypot(s.figs[0].x - f0.x, s.figs[0].z - f0.z) > 0.5, `${f0.x},${f0.z} → ${s.figs[0].x},${s.figs[0].z}`);
    await shot('run');

    // IT (P2) touches P1.
    await G('_debugPlace', 0, 0, 5);
    await G('_debugPlace', 1, 0, 5.8);
    await page.waitForTimeout(300);
    s = await state();
    ok('IT touching the runner passes it on', s.it === 0 && s.tags >= 1, `it ${s.it} tags ${s.tags}`);
    ok('…and the new IT is frozen', s.figs[0].frozen > 0, `frozen ${s.figs[0].frozen}`);
    await shot('tag');
    // Frozen: a drag does nothing.
    const fz = (await state()).figs[0];
    await page.mouse.move(206, 780); await page.mouse.down();
    await page.mouse.move(206, 700, { steps: 2 });
    await page.waitForTimeout(250);
    s = await state();
    await page.mouse.up();
    ok('a frozen player cannot move', Math.hypot(s.figs[0].x - fz.x, s.figs[0].z - fz.z) < 0.05 || s.figs[0].frozen === 0, `${fz.x},${fz.z} → ${s.figs[0].x},${s.figs[0].z}`);

    // The roundabout and the tunnel.
    await page.waitForTimeout(1500);
    await G('_debugPlace', 1, s.round.x + 1.0, s.round.z);
    await G('_debugPlace', 0, -4, -6);
    await page.waitForTimeout(700);
    const r1 = (await state()).figs[1];
    ok('the roundabout carries whoever stands on it', Math.hypot(r1.x - (s.round.x + 1.0), r1.z - s.round.z) > 0.15, `${r1.x},${r1.z}`);
    await G('_debugPlace', 1, s.tunnel.x, s.tunnel.z);
    await page.waitForTimeout(250);
    const tn = await state();
    ok('the tunnel hides whoever is in it', tn.figs[1].hidden, JSON.stringify(tn.figs[1]));
    await shot('tunnel');

    // The whistle.
    // Apart first, then IT, so no tag can happen in between.
    await G('_debugPlace', 0, 4, 6);
    await G('_debugPlace', 1, -4, -6);
    await G('_debugIt', 1);
    await G('_debugClock', 39.9);
    const r = await waitResult(20000);
    ok('whoever is IT at the whistle loses', !!r && r.winner === 0, r ? `winner ${r.winner}` : 'no result');

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r2 = await waitResult(180000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r2 && r2.winner === 1, r2 ? `winner=${r2.winner} in ${(r2.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
