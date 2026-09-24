// ============================================================
// BUMPER CARS — the fair in the park, face-off hold.
//   1. Built, not turned.
//   2. A real drag drives P1's car.
//   3. A real tap boosts, and the boost goes on cooldown.
//   4. Shoving the rival hard into the rail zaps them: P1 scores.
//   5. Driving yourself into the rail gives the rival the point.
//   6. A brush against the rail only bounces.
//   7. A hard bot beats an idle player; nothing leaks; no errors.
// usage: node bumpercars.js          (screenshots: qa/shot-bumpercars-*.png)
// ============================================================
require('./stageprobe').run('bumpercars', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('the rink is built, face-off hold not turned', s.gl && !s.turned);
    await waitPhase('play');

    const from = (await state()).cars[0];
    await page.mouse.move(206, 780); await page.mouse.down();
    await page.mouse.move(206, 700, { steps: 4 });
    await page.waitForTimeout(900);
    s = await state();
    await page.mouse.up();
    ok('a drag drives P1', Math.hypot(s.cars[0].x - from.x, s.cars[0].z - from.z) > 0.5, `${from.x},${from.z} → ${s.cars[0].x},${s.cars[0].z}`);
    await shot('drive');

    await page.waitForTimeout(600);
    const v0 = (await state()).cars[0].v;
    await page.mouse.click(206, 760);
    await page.waitForTimeout(120);
    s = await state();
    ok('a tap boosts and starts the cooldown', s.cars[0].cd > 2 && s.cars[0].v > v0 + 2, `v ${v0} → ${s.cars[0].v}, cd ${s.cars[0].cd}`);

    // Ram P2 into the right-hand rail.
    await page.evaluate(() => { window.__G._debugPlace(1, 2.8, 0, 0, 0); window.__G._debugPlace(0, 0.8, 0, 7, 0); });
    await page.waitForTimeout(900);
    s = await state();
    ok('shoving the rival into the rail zaps them: P1 scores', s.score[0] === 1, `score ${s.score}`);
    await shot('zap');

    // Drive yourself into the far rail.
    await page.evaluate(() => { window.__G._debugPlace(1, 0, -5, 0, 0); window.__G._debugPlace(0, -2.5, 3, -6, 0); });
    await page.waitForTimeout(900);
    s = await state();
    ok('driving yourself into the rail scores for the rival', s.score[1] === 1, `score ${s.score}`);

    // A brush only bounces.
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__G._debugPlace(1, 0, -5, 0, 0); window.__G._debugPlace(0, 2.8, 4, 1.2, 0); });
    await page.waitForTimeout(700);
    const s2 = await state();
    ok('a brush against the rail only bounces', s2.score[1] === 1 && s2.score[0] === 1, `score ${s2.score}`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(150000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
