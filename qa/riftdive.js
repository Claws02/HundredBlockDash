// ============================================================
// RIFT DIVE — the Void shaft on the shared stage, face-off, split-screen.
//
//   1. Built, not turned; the dive draws two views, one per half.
//   2. A real drag on P1's half steers P1 the way it points on screen; one on
//      P2's half steers P2 the way it points on THEIR screen (turned).
//   3. Through a ring: counted, and a burst of speed.
//   4. Into a shard: a tumble.
//   5. Two divers side by side bump apart.
//   6. A hard bot beats an idle player; nothing leaks; no errors.
//
// usage: node riftdive.js          (screenshots: qa/shot-riftdive-*.png)
// ============================================================
require('./stageprobe').run('riftdive', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('rift built, face-off hold is not turned', s.gl && !s.turned);
    await waitPhase('dive');
    s = await state();
    ok('the dive is split-screen, a view per half', s.views === 2, `views=${s.views}`);

    // Steering. Screen right on P1's (bottom) half is +x; on P2's (top, turned)
    // half, screen right is -x in the world — which is right on THEIR view.
    const drag = async (x, y, dx) => {
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + dx, y, { steps: 4 });
        await page.waitForTimeout(500);
        await page.mouse.up();
    };
    await page.evaluate(() => { window.__G._debugPlace(0, 0, -3, 0); window.__G._debugPlace(1, 0, -3, 0.01); });
    let a = await state();
    await drag(206, 700, 70);
    s = await state();
    ok('a real drag right on P1\'s half steers P1 to +x', s.pos[0][0] > a.pos[0][0] + 0.8, `${a.pos[0][0]} → ${s.pos[0][0]}`);
    a = await state();
    await drag(206, 200, 70);
    s = await state();
    ok('a real drag right on P2\'s turned half steers P2 to -x', s.pos[1][0] < a.pos[1][0] - 0.8, `${a.pos[1][0]} → ${s.pos[1][0]}`);
    await shot('dive');

    // A ring and a shard, from just above each.
    const C = await page.evaluate(() => window.__G._debugCourse());
    const ring = C.rings.find(r => r[1] < -60 && !C.shards.some(q => Math.abs(q[1] - r[1]) < 4 && Math.hypot(q[0] - r[0], q[2] - r[2]) < 2.5));
    // Read the frame the ring is counted: a shard further down would zero the boost.
    const thru = await page.evaluate(r => new Promise(res => {
        const G = window.__G, n0 = G._debugState().rings[0], t0 = performance.now();
        G._debugPlace(0, r[0], r[1] + 3, r[2]);
        const tick = () => {
            const st = G._debugState();
            if (st.rings[0] > n0 || performance.now() - t0 > 3000) return res({ n0, n1: st.rings[0], boost: st.boost[0] });
            requestAnimationFrame(tick);
        };
        tick();
    }), ring);
    ok('through a ring: counted, and a burst of speed', thru.n1 === thru.n0 + 1 && thru.boost > 0, `rings ${thru.n0} → ${thru.n1}, boost ${thru.boost}`);
    const shard = C.shards.find(q => q[1] < -100);
    await page.evaluate(q => window.__G._debugPlace(0, q[0], q[1] + 2.5, q[2]), shard);
    let stunned = false;
    for (let i = 0; i < 12 && !stunned; i++) { await page.waitForTimeout(60); stunned = (await state()).stun[0]; }
    ok('into a shard: a tumble', stunned);

    // Side by side, nearly touching.
    await page.evaluate(() => { window.__G._debugPlace(0, 0.3, -200, 0); window.__G._debugPlace(1, -0.3, -200, 0); });
    await page.waitForTimeout(250);
    s = await state();
    ok('two divers side by side bump apart', s.pos[0][0] - s.pos[1][0] > 1.2, `apart ${(s.pos[0][0] - s.pos[1][0]).toFixed(2)}`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(90000, async () => {
        const st = await state();
        if (st && st.phase === 'dive' && st.clock > 6 && !globalThis.__mid) { globalThis.__mid = 1; await shot('race'); }
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
