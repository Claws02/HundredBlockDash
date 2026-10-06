// ============================================================
// BRAINROT TOWER — probe.
//   1. The stage builds in the upright hold: portrait, not turned.
//   2. A real drag on the slider aims the claw; a real press on DROP lets go
//      there. Once the critter settles it's P2's turn.
//   3. Dragging anywhere on the screen aims too.
//   4. Critters dropped on the middle stack up; the camera rises with them.
//   5. Nothing leaves the picture's plane: no depth, no tilt toward the camera.
//   6. Shoving the top critter off the plinth: whoever dropped last loses.
//   7. A critter dropped past the plinth's edge loses on the spot.
//   8. Leave the claw where it comes in and it lets go there, off the edge.
//   9. A hard bot beats a player who never touches it; one result.
// 3 and 4 seats run through the real ready gate in qa/livegames.js
// (QA_ONLY=brainrot node qa/livegames.js 3 4).
// usage: node qa/brainrot.js          (screenshots: qa/shot-brainrot-*.png)
// ============================================================
require('./stageprobe').run('brainrot', async ({ page, ok, launch, state, result, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const until = async (pred, ms = 30000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && pred(s)) return s; await page.waitForTimeout(150); }
        return state();
    };
    const RANGE = 2.3;
    const trackX = (c, x) => c.l + ((x / RANGE) + 1) / 2 * (c.r - c.l);

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('stage built with physics, upright hold, not turned', s.gl && s.physics && s.hold === 'upright' && !s.turned, JSON.stringify({ gl: s.gl, physics: s.physics, hold: s.hold, turned: s.turned }));
    await waitPhase('play');
    s = await state();
    ok('play opens on P1 with the claw out past the plinth\'s edge', s.turn === 0 && !!s.held && Math.abs(s.clawX) > 1.7, JSON.stringify({ turn: s.turn, held: s.held, clawX: s.clawX }));

    // 2. The slider, then DROP, with a real mouse.
    await G('_debugFreeze', true);
    await G('_debugHold', 'pizza');
    const c = await G('_debugControls');
    await page.mouse.move(trackX(c, 1.2), c.y); await page.mouse.down();
    await page.mouse.move(trackX(c, 0.3), c.y, { steps: 6 }); await page.mouse.up();
    s = await state();
    ok('dragging the slider aims the claw', Math.abs(s.clawX - 0.3) < 0.06 && s.drops === 0, `clawX ${s.clawX}`);
    await shot('aim');
    await page.mouse.click(c.bx, c.by);
    s = await until(x => x.drops === 1);
    ok('DROP lets go where the claw is', s.drops === 1 && Math.abs(s.pieces[0].x - 0.3) < 0.06, JSON.stringify(s.pieces));
    s = await until(x => x.turn === 1 && !x.settling);
    ok('once it settles the claw moves on to P2', s.turn === 1 && !!s.held && s.toppler < 0, JSON.stringify({ turn: s.turn, held: s.held, top: s.top }));

    // 3. Anywhere on the screen aims.
    await page.mouse.move(c.l + 20, 300); await page.mouse.down();
    await page.mouse.move((c.l + c.r) / 2, 320, { steps: 6 }); await page.mouse.up();
    s = await state();
    ok('a drag anywhere on the screen aims too', Math.abs(s.clawX) < 0.08 && s.drops === 1, `clawX ${s.clawX}`);
    await shot('first');

    // 4. A few known shapes, dropped on the middle, stack.
    const top0 = s.top, cam0 = s.camY;
    for (const key of ['fridge', 'pizza', 'cup', 'banana']) {
        await G('_debugHold', key);
        const turn = (await state()).turn;
        await G('_debugDropAt', 0);
        s = await until(x => x.turn !== turn && !x.settling && !!x.held);
    }
    s = await state();
    ok('critters dropped on the middle stack up', s.toppler < 0 && s.pieces.filter(p => !p.off).length === 5 && s.top > top0 + 0.4,
       `top ${top0} → ${s.top}, ${s.pieces.map(p => p.key).join(',')}`);
    ok('the camera rises with the tower', s.camY > cam0 + 0.3, `${cam0} → ${s.camY}`);
    await shot('stack');

    // 6. Shove the top one off: the last to drop knocked it over.
    const last = s.pieces[s.pieces.length - 1].slot;
    await G('_debugShove', 6);
    s = await until(x => x.toppler >= 0, 8000);
    ok('anything off the plinth is a topple, blamed on the last to drop', s.toppler === last, `toppler ${s.toppler}, last dropper ${last}`);
    await page.waitForTimeout(600);
    s = await state();
    // 5. ...and through all of that, and the collapse, nothing left the plane.
    ok('critters stay in the picture\'s plane, even falling', s.depth < 1e-3 && s.tilt < 1e-3, `depth ${s.depth}, tilt ${s.tilt}`);
    await shot('topple');
    let r = await waitResult(30000);
    ok('the other player wins', !!r && r.winner === 1 - last, r ? `winner=${r.winner}` : 'no result');
    await page.waitForTimeout(400);

    // 7. Past the edge on the very first drop.
    await launch();
    await waitPhase('play');
    await G('_debugFreeze', true);
    await G('_debugDropAt', 2.2);
    s = await until(x => x.toppler >= 0, 8000);
    r = await waitResult(30000);
    ok('a critter dropped off the edge loses on the spot', s.toppler === 0 && !!r && r.winner === 1, `toppler ${s.toppler}, winner ${r && r.winner}`);
    await page.waitForTimeout(400);

    // 8. The turn clock: the claw lets go where it came in, past the edge.
    await launch();
    await waitPhase('play');
    s = await state();
    const tt = s.turnTime;
    s = await until(x => x.drops === 1, (tt + 6) * 1000 * 3);
    ok('the claw lets go by itself when the turn clock runs out', s.drops === 1, `turnTime ${tt}s, drops ${s.drops}`);
    s = await until(x => x.toppler >= 0, 8000);
    ok('...and left where it came in, that is off the edge', s.toppler === 0, `toppler ${s.toppler}`);
    await forceEnd();
    await page.waitForTimeout(300);

    // 9. A hard bot against a player who never touches it.
    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    r = await waitResult(240000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats a player who never touches it', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await page.waitForTimeout(500);
    const again = await result();
    ok('the result reports once', !!again && again.winner === r?.winner);
    await cleanup();
});
