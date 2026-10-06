// ============================================================
// BRAINROT TOWER — probe.
//   1. The stage builds in the side-on hold (turned on a portrait phone).
//   2. A real tap anywhere drops P1's critter; once it settles it's P2's turn.
//   3. Critters dropped on the middle stack up, and the camera rises with them.
//   4. Shoving the top critter off the plinth: whoever dropped last loses.
//   5. A critter dropped past the plinth's edge loses on the spot.
//   6. Wait out the turn clock and the claw lets go by itself.
//   7. A hard bot beats a player who never taps; the result reports once.
// 3 and 4 seats run through the real ready gate in qa/livegames.js
// (QA_ONLY=brainrot node qa/livegames.js).
// usage: node qa/brainrot.js          (screenshots: qa/shot-brainrot-*.png)
// ============================================================
require('./stageprobe').run('brainrot', async ({ page, ok, launch, state, result, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const until = async (pred, ms = 30000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && pred(s)) return s; await page.waitForTimeout(150); }
        return state();
    };

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('stage built with physics, side-on hold turned on a portrait phone', s.gl && s.physics && s.turned, JSON.stringify({ gl: s.gl, physics: s.physics, turned: s.turned }));
    await waitPhase('play');
    s = await state();
    ok('play opens on P1 with a critter on the claw', s.turn === 0 && !!s.held, JSON.stringify({ turn: s.turn, held: s.held }));

    // 2. A real tap (anywhere: it's P1's turn) lets go.
    await G('_debugFreeze', true, 0);
    await G('_debugHold', 'pizza');
    await page.mouse.click(206, 300);
    s = await until(x => x.drops === 1);
    ok('a tap drops the critter', s.drops === 1 && s.pieces.length === 1, JSON.stringify(s.pieces));
    s = await until(x => x.turn === 1 && !x.settling);
    ok('once it settles the claw moves on to P2', s.turn === 1 && !!s.held && s.toppler < 0, JSON.stringify({ turn: s.turn, held: s.held, top: s.top }));
    await shot('first');

    // 3. A few known shapes, dropped on the middle, stack.
    const top0 = s.top, cam0 = s.camY;
    for (const key of ['fridge', 'pizza', 'cup']) {
        await G('_debugHold', key);
        const turn = (await state()).turn;
        await G('_debugDropAt', 0);
        s = await until(x => x.turn !== turn && !x.settling && !!x.held);
        console.log('  after', key, JSON.stringify(s.pieces.map(p => [p.key, p.x, p.y, p.off])), 'toppler', s.toppler);
    }
    s = await state();
    ok('critters dropped on the middle stack up', s.toppler < 0 && s.pieces.filter(p => !p.off).length === 4 && s.top > top0 + 0.4,
       `top ${top0} → ${s.top}, ${s.pieces.map(p => p.key).join(',')}`);
    ok('the camera rises with the tower', s.camY > cam0 + 0.3, `${cam0} → ${s.camY}`);
    await shot('stack');

    // 4. Shove the top one off: the last to drop knocked it over.
    const last = s.pieces[s.pieces.length - 1].slot;
    await G('_debugShove', 6);
    s = await until(x => x.toppler >= 0, 8000);
    ok('anything off the plinth is a topple, blamed on the last to drop', s.toppler === last, `toppler ${s.toppler}, last dropper ${last}`);
    await page.waitForTimeout(500);
    await shot('topple');
    let r = await waitResult(30000);
    ok('the other player wins', !!r && r.winner === 1 - last, r ? `winner=${r.winner}` : 'no result');
    await page.waitForTimeout(400);

    // 5. Past the edge on the very first drop.
    await launch();
    await waitPhase('play');
    await G('_debugFreeze', true);
    await G('_debugDropAt', 1.75);
    s = await until(x => x.toppler >= 0, 8000);
    r = await waitResult(30000);
    ok('a critter dropped off the edge loses on the spot', s.toppler === 0 && !!r && r.winner === 1, `toppler ${s.toppler}, winner ${r && r.winner}`);
    await page.waitForTimeout(400);

    // 6. The turn clock.
    await launch();
    await waitPhase('play');
    s = await state();
    const tt = s.turnTime;
    s = await until(x => x.drops === 1, (tt + 6) * 1000 * 3);
    ok('the claw lets go by itself when the turn clock runs out', s.drops === 1, `turnTime ${tt}s, drops ${s.drops}`);
    await forceEnd();
    await page.waitForTimeout(300);

    // 7. A hard bot against a player who never taps.
    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    r = await waitResult(240000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    s = await state().catch(() => null);
    ok('a hard bot beats a player who never taps', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await page.waitForTimeout(500);
    const again = await result();
    ok('the result reports once', !!again && again.winner === r?.winner);
    await cleanup();
});
