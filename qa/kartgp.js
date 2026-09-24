// ============================================================
// GO-KART GRAND PRIX — the park circuit, split screen.
//   1. Built; two views (split screen) once the race is set.
//   2. The kart drives itself off the line.
//   3. A real drag right on P1's half steers P1 right.
//   4. Grass is slow; the shortcut path is full speed.
//   5. A hard steer at speed charges a drift; straightening fires a turbo.
//   6. A banana dropped with a real tap spins out the kart that hits it.
//   7. Crossing the line on the last lap finishes the race for that kart.
//   8. A hard bot finishes 3 laps and beats an idle player; no leaks, no errors.
// usage: node kartgp.js          (screenshots: qa/shot-kartgp-*.png)
// ============================================================
require('./stageprobe').run('kartgp', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(60); }
        return state();
    };
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    await waitPhase('ready', 30000);
    let s = await state();
    ok('split screen once the race is set', s.gl && s.views === 2, `views ${s.views}`);
    await waitPhase('race', 30000);
    await page.waitForTimeout(1200);
    s = await state();
    ok('the kart drives itself off the line', s.karts[0].v > 3, `v ${s.karts[0].v}`);
    await shot('race');

    // Steer right with a real drag on the bottom half.
    await page.evaluate(() => window.__G._debugPlace(0, 10, -8, 0, 10));
    const h0 = (await state()).karts[0].h;
    await page.mouse.move(206, 760); await page.mouse.down();
    await page.mouse.move(236, 760, { steps: 3 });
    await page.waitForTimeout(500);
    s = await state();
    await page.mouse.up();
    ok('a drag right steers P1 right (heading turns clockwise)', s.karts[0].h < h0 - 0.05, `h ${h0} → ${s.karts[0].h}`);

    // Surfaces.
    await page.evaluate(() => window.__G._debugPlace(0, 5, 9, 0, 12));
    await page.waitForTimeout(900);
    const g = (await state()).karts[0];
    await page.evaluate(() => window.__G._debugPlace(0, -8, -15, Math.PI / 2, 12));
    await page.waitForTimeout(400);
    const p = (await state()).karts[0];
    ok('the grass is slow', g.surf < 1 && g.v < 8, `surf ${g.surf} v ${g.v}`);
    ok('the shortcut path is full speed', p.surf === 1, `surf ${p.surf} at ${p.x},${p.z}`);

    // Drift: a hard steer at speed, then straighten.
    await page.evaluate(() => window.__G._debugPlace(0, 10, -12, 0, 12));
    await page.mouse.move(206, 760); await page.mouse.down();
    await page.mouse.move(266, 760, { steps: 2 });
    s = await waitFor(st => st.karts[0].drift >= 0.75, 6000);
    const charged = s.karts[0].drift;
    await shot('drift');
    await page.mouse.up();
    s = await waitFor(st => st.karts[0].boost > 0, 3000);
    ok('a hard steer at speed charges a drift, and straightening fires a turbo', charged >= 0.7 && s.karts[0].boost > 0, `drift ${charged} boost ${s.karts[0].boost}`);

    // A banana, dropped with a real tap, spins out the rival.
    await page.evaluate(() => { window.__G._debugPlace(0, 10, 0, 0, 0.5); window.__G._debugItem(0, 'banana'); window.__G._debugPlace(1, 10, -9, 0, 9); });
    await page.mouse.click(206, 760);
    s = await waitFor(st => st.karts[1].spin > 0, 4000);
    ok('a banana dropped with a tap spins out the kart that hits it', s.karts[1].spin > 0 && s.karts[0].item === null, `spin ${s.karts[1].spin}`);

    // The finish.
    await page.evaluate(() => { window.__G._debugLap(0, 2, true); window.__G._debugPlace(0, 10, -3, 0, 12); });
    s = await waitFor(st => st.winner >= 0, 5000);
    ok('crossing the line on the last lap finishes the race', s.winner === 0 && s.karts[0].done, `winner ${s.winner}`);
    s = await waitFor(st => st.phase === 'over', 8000);
    ok('then the race ends and the verdict is full-frame', s.phase === 'over' && s.views === 0, `phase ${s.phase} views ${s.views}`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false, sawCut = false;
    const r = await waitResult(600000, async () => {
        const st = await state();
        if (st && st.karts && Math.abs(st.karts[1].z + 15) < 1.2 && Math.abs(st.karts[1].x) < 5) sawCut = true;
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot races 3 laps and beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    ok('the hard bot takes the shortcut', sawCut);
    await cleanup();
});
