// ============================================================
// TURF WAR — the paint yard on the shared stage, face-off hold.
//
//   1. Built, not turned.
//   2. A real drag on the bottom half runs P1, and the yard turns P1's colour.
//   3. Running on the rival's paint is slower than on bare concrete.
//   4. A paint bomb splats a patch in the colour of whoever runs over it.
//   5. A hard bot out-paints an idle player; nothing leaks; no errors.
//
// usage: node turfwar.js          (screenshots: qa/shot-turfwar-*.png)
// ============================================================
require('./stageprobe').run('turfwar', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('yard built, face-off hold is not turned', s.gl && !s.turned);
    await waitPhase('play');

    // Run up the yard.
    const c0 = s.count[0];
    await page.mouse.move(206, 740); await page.mouse.down();
    await page.mouse.move(206, 690, { steps: 4 });
    await page.waitForTimeout(900);
    await page.mouse.up();
    s = await state();
    ok('a drag on the bottom half runs P1 and paints the yard', s.count[0] >= c0 + 4, `${c0} → ${s.count[0]} tiles`);
    await shot('play');

    // Speed on bare concrete, then across a strip of P2's paint.
    // Speed in units per second of GAME time: a software renderer's frames
    // are too uneven for distance per wall-clock second to mean anything.
    const pace = async () => {
        await page.mouse.move(206, 740); await page.mouse.down();
        await page.mouse.move(150, 740, { steps: 3 });     // stage -x: across the yard
        await page.waitForTimeout(150);
        const a = await state();
        await page.waitForTimeout(500);
        const b = await state();
        await page.mouse.up();
        return Math.abs(b.pos[0][0] - a.pos[0][0]) / Math.max(0.01, b.clock - a.clock);
    };
    await page.evaluate(() => window.__G._debugPlace(0, 4, 0));
    const bare = await pace();
    await page.evaluate(() => { window.__G._debugPaint(1, -5, -1, 5, 1); window.__G._debugPlace(0, 4, 0); });
    const wet = await pace();
    ok('their wet paint slows you down', wet < bare * 0.9, `bare ${bare.toFixed(2)} · on their paint ${wet.toFixed(2)}`);

    // A bomb at P1's feet.
    const before = (await state()).count[0];
    await page.evaluate(() => { const p = window.__G._debugState().pos[0]; window.__G._debugBomb(p[0], p[1]); });
    await page.waitForTimeout(300);
    await shot('bomb');
    s = await state();
    ok('a paint bomb splats a patch in your colour', s.count[0] >= before + 8, `${before} → ${s.count[0]}`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(90000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot out-paints an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
