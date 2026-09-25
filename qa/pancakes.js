// ============================================================
// PANCAKE STACK — the diner counter, side-on, real physics.
//   1. Built in the side hold (turned in portrait), with physics.
//   2. A real tap on P1's half drops a pancake onto the plate.
//   3. Dropped well off the plate, it falls to the counter and doesn't count.
//   4. Dropped centred, they stack: five in a row stand.
//   5. Dropped far off-centre onto a stack, the stack topples.
//   6. The dropper speeds up as the stack grows; time up: most on the plate wins.
//   7. A hard bot beats an idle player; no leaks, no errors.
// usage: node pancakes.js          (screenshots: qa/shot-pancakes-*.png)
// ============================================================
require('./stageprobe').run('pancakes', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const settle = ms => page.waitForTimeout(ms);

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('built in the side hold, with physics', s.gl && s.turned && s.physics);
    await waitPhase('play', 30000);
    await G('_debugFreeze', true);
    await settle(700);

    // Line the swing up over the plate, then a real tap.
    await page.evaluate(() => window.__G._debugState());
    await G('_debugFreeze', false);
    let tries = 0;
    do { s = await state(); if (Math.abs(s.players[0].heldX - 2.3) < 0.35 && s.players[0].held) break; await settle(30); } while (++tries < 200);
    await page.mouse.click(206, 700);
    await settle(1800);
    s = await state();
    ok('a real tap drops a pancake onto the plate', s.players[0].drops === 1 && s.players[0].count === 1, JSON.stringify(s.players[0]));
    await G('_debugFreeze', true);

    await G('_debugDropAt', 0, 1.4);
    await settle(2000);
    s = await state();
    ok('well off the plate, it falls to the floor and does not count', s.players[0].drops === 2 && s.players[0].count === 1 && s.lowest < 0.3, `${JSON.stringify(s.players[0])} lowest y ${s.lowest}`);

    for (let i = 0; i < 5; i++) { await G('_debugDropAt', 0, (Math.random() - 0.5) * 0.08); await settle(900); }
    await settle(800);
    s = await state();
    await shot('stack');
    ok('dropped centred, they stack, and the score is the height plate to top', s.players[0].count === 6 && Math.abs(s.players[0].height - 6 * 0.13) < 0.08, `count ${s.players[0].count} height ${s.players[0].height}`);

    // No jolt: the camera doesn't jump up when a pancake is dropped.
    let base = (await state()).camY, peak = base;
    await G('_debugDropAt', 0, 0);
    for (let i = 0; i < 20; i++) { peak = Math.max(peak, (await state()).camY); await settle(40); }
    ok('dropping a pancake does not jolt the camera up', peak - base < 0.12, `camera y ${base} peaked at ${peak}`);
    await settle(700);

    // A lean: each pancake a little further out than the last. Each one on its
    // own would sit (it overlaps the one below), but the stack's weight ends
    // up past its base and the top of it comes down.
    const lean = [0, 0.25, 0.5, 0.75, 1.0, 1.25];
    for (const dx of lean) { await G('_debugDropAt', 1, dx); await settle(900); }
    await settle(1500);
    s = await state();
    await shot('topple');
    ok('a stack that leans too far topples', s.players[1].count < lean.length, `${lean.length} leaning drops → ${s.players[1].count} still on the plate`);

    await G('_debugFreeze', false);
    await G('_debugClock', 39.5);
    const r0 = await waitResult(15000, async () => { const st = await state(); if (st && st.phase === 'over') await shot('verdict'); });
    ok('time up: the taller stack wins', !!r0 && r0.winner === 0, r0 ? `winner ${r0.winner}` : 'no result');

    await launch({ bot: true, skill: 0.85 });
    let mid = false;
    const r = await waitResult(120000, async () => {
        const st = await state();
        if (st && st.phase === 'play' && st.clock > 25 && !mid) { mid = true; await shot('race'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
