// ============================================================
// SPEED BOAT — the 3D river, split screen.
//   1. Built; two views (split screen) once the race is set.
//   2. Boats run off the line in CRUISE.
//   3. A real tap on P1's half shifts gear; a real drag right steers right.
//   4. Hitting a line of rocks outside the gate stalls, pins and drops to SLOW.
//   5. Steering the pinned hull over the gate frees it.
//   6. Reaching the flag wins; the verdict is full-frame.
//   7. A hard bot beats an idle player; no leaks, no errors.
// usage: node speedboat.js          (screenshots: qa/shot-speedboat-*.png)
// ============================================================
require('./stageprobe').run('speedboat', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
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
    await page.waitForTimeout(1000);
    s = await state();
    ok('boats run off the line in CRUISE', s.boats[0].d > 0.4 && s.boats[0].gear === 1, JSON.stringify(s.boats[0]));
    await shot('race');

    await page.mouse.click(206, 760);
    s = await waitFor(st => st.boats[0].gear === 2, 2000);
    ok('a tap on P1\'s half shifts up to FLAT OUT', s.boats[0].gear === 2, `gear ${s.boats[0].gear}`);

    await page.evaluate(() => { window.__G._debugPlace(0, 0.4, 1.0); window.__G._debugGear(0, 0); });
    await page.mouse.move(206, 760); await page.mouse.down();
    await page.mouse.move(266, 760, { steps: 3 });
    await page.waitForTimeout(500);
    s = await state();
    await page.mouse.up();
    ok('a drag right steers P1 right', s.boats[0].u > 0.5, `u 0.4 → ${s.boats[0].u}`);
    await shot('steer');

    // Into the rocks at speed.
    s = await state();
    let nx = s.boats[0].next;
    const off = nx.gap > 0.5 ? nx.gap - 0.4 : nx.gap + 0.4;
    await page.evaluate(([u, d]) => { window.__G._debugPlace(0, u, d); window.__G._debugGear(0, 2); }, [off, nx.d - 0.25]);
    s = await waitFor(st => st.boats[0].pinned, 3000);
    ok('outside the gate, a line of rocks stalls, pins and drops you to SLOW',
       s.boats[0].pinned && s.boats[0].stall > 0.5 && s.boats[0].gear === 0 && s.boats[0].hits >= 1, JSON.stringify(s.boats[0]));
    await shot('rocks');
    // Hit again, then steer for the gate with a real drag and let go over it.
    await page.evaluate(([u, d]) => window.__G._debugPlace(0, u, d), [off, nx.d - 0.2]);
    s = await waitFor(st => st.boats[0].pinned, 3000);
    const d0 = s.boats[0].d;
    const dir = nx.gap > off ? 1 : -1;               // +1 = right = drag +x on P1's half
    await page.mouse.move(206, 760); await page.mouse.down();
    await page.mouse.move(206 + dir * 60, 760, { steps: 3 });
    await waitFor(st => Math.abs(st.boats[0].u - nx.gap) < 0.04, 6000);
    await page.mouse.up();
    s = await waitFor(st => !st.boats[0].pinned && st.boats[0].d > d0 + 0.2, 6000);
    ok('steering the hull over the gate frees it', !s.boats[0].pinned && s.boats[0].d > d0 + 0.2, `u ${s.boats[0].u} gap ${nx.gap} d ${d0} → ${s.boats[0].d}`);

    await page.evaluate(() => window.__G._debugPlace(0, 0.5, 29.8));
    s = await waitFor(st => st.winner >= 0, 5000);
    ok('reaching the flag wins', s.winner === 0, `winner ${s.winner}`);
    await shot('finish');
    s = await waitFor(st => st.phase === 'over', 8000);
    ok('then the race ends and the verdict is full-frame', s.phase === 'over' && s.views === 0, `phase ${s.phase} views ${s.views}`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(600000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
