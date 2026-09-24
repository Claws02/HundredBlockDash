// ============================================================
// LILY PAD LEAP — the fae pond on the shared stage, face-off hold.
//
//   1. Built, not turned.
//   2. Landing on the rival's pad stomps them off it.
//   3. A real drag on the bottom half aims P1; letting go hops to a new pad.
//   4. A pad drains under a standing figure until it sinks and they splash.
//   5. A hard bot beats an idle player; nothing leaks; no errors.
//
// usage: node lilypad.js          (screenshots: qa/shot-lilypad-*.png)
// ============================================================
require('./stageprobe').run('lilypad', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('pond built, face-off hold is not turned', s.gl && !s.turned);
    await waitPhase('play');
    const settled = async () => {
        for (let i = 0; i < 30; i++) { const st = await state(); if (!st.hopping[0] && !st.hopping[1]) return st; await page.waitForTimeout(100); }
        return state();
    };

    // Aim up the pond and let go.
    s = await state();
    const from = s.pad[0];
    await page.mouse.move(206, 760); await page.mouse.down();
    await page.mouse.move(206, 690, { steps: 3 });
    const aiming = await state();
    await shot('aim');
    await page.mouse.up();
    await page.waitForTimeout(300);
    s = await settled();
    ok('a drag on the bottom half aims P1', aiming.aim[0] >= 0, `aim=${aiming.aim[0]}`);
    ok('letting go hops P1 to a new pad', s.pad[0] !== from && !s.out[0], `${from} → ${s.pad[0]}`);

    // Stand still: the pad drains and sinks.
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
        s = await state();
        if (s.out[0] || s.out[1] || s.phase !== 'play') break;
        await page.waitForTimeout(250);
    }
    ok('a pad sinks under a figure who stands still, and they splash', s.out[0] || s.out[1], `out=${s.out} round=${s.round}`);
    await shot('splash');
    await forceEnd();

    // Stomp: a fresh round, land straight on the rival's pad.
    await launch();
    await waitPhase('play');
    s = await state();
    const rival = s.pad[1];
    const hopped = await page.evaluate(to => window.__G._debugHop(0, to), rival);
    await page.waitForTimeout(300);
    s = await settled();
    ok('landing on the rival stomps them off their pad', hopped && s.pad[0] === rival && (s.pad[1] !== rival || s.out[1]),
        `hopped=${hopped} P1 on ${s.pad[0]}, P2 on ${s.pad[1]} out=${s.out[1]}`);
    await shot('stomp');
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(90000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
