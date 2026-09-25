// ============================================================
// MINI GOLF — the crazy golf in the park, side-on hold.
//   1. Built, turned sideways in portrait.
//   2. A real drag back and release on P1's half putts P1's ball the other way.
//   3. The stroke counts, and once the balls stop it is P2's turn.
//   4. A ball rolling slowly over the cup drops in.
//   5. The loop: hard enough goes round, too soft rolls back.
//   6. The pond: water costs a stroke and puts the ball back.
//   7. A hard bot beats an idle player; nothing leaks; no errors.
// usage: node minigolf.js          (screenshots: qa/shot-minigolf-*.png)
// ============================================================
require('./stageprobe').run('minigolf', async ({ page, ok, launch, state, shot, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const waitFor = async (fn, ms = 40000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(60); }
        return state();
    };
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('the course is built, turned sideways in portrait', s.gl && s.turned);
    s = await waitFor(st => st.sub === 'aim' && st.turn === 0);
    const b0 = s.balls[0];
    // Landscape "left" is the portrait screen's top: pulling up putts toward
    // the cup (+x). P1's half is the screen's bottom half.
    await page.mouse.move(206, 700); await page.mouse.down();
    await page.mouse.move(206, 630, { steps: 4 });
    await shot('aim');
    await page.mouse.up();
    await page.waitForTimeout(400);
    s = await state();
    ok('a real drag back and release putts P1 toward the cup', s.balls[0].x > b0.x + 0.2 || s.balls[0].v > 1, `${b0.x} → ${s.balls[0].x}, v ${s.balls[0].v}`);
    ok('the stroke counts', s.strokes[0][0] === 1, JSON.stringify(s.strokes));
    s = await waitFor(st => st.sub === 'aim', 30000);
    ok('once the balls stop, it is P2\'s turn', s.turn === 1, `turn ${s.turn}`);
    await shot('rolled');

    // The cup: a gentle putt from just short of it.
    const cup = s.cup;
    await G('_debugBall', 1, cup[0] - 1.0, cup[1]);
    await G('_debugShoot', 1, 1, 0, 0.3);
    s = await waitFor(st => st.balls[1].holed || (st.sub !== 'roll'), 15000);
    ok('a slow ball over the cup drops in', s.balls[1].holed, JSON.stringify(s.balls[1]));
    await forceEnd();

    // Hole 2: the loop.
    await launch();
    s = await waitFor(st => st.sub === 'aim' && st.hole === 0);
    await G('_debugHole', 1);
    s = await waitFor(st => st.sub === 'aim' && st.hole === 1);
    await G('_debugBall', s.turn, -4, -2.1);
    await G('_debugShoot', s.turn, 1, 0, 1);
    let sawLoop = false, st2;
    for (let i = 0; i < 80; i++) { st2 = await state(); if (st2.balls[s.turn].loop) sawLoop = true; if (st2.balls[s.turn].x > 1.6) break; await page.waitForTimeout(60); }
    await shot('loop');
    ok('the loop: hard enough goes round', st2.balls[s.turn].x > 1.6, `x ${st2.balls[s.turn].x} loop seen ${sawLoop}`);
    s = await waitFor(st => st.sub === 'aim', 30000);
    await G('_debugBall', s.turn, -3, -2.1);
    await G('_debugShoot', s.turn, 1, 0, 0.45);
    await page.waitForTimeout(1500);
    s = await waitFor(st => st.sub === 'aim' || st.sub === 'tally', 30000);
    const soft = s.balls.find((b, i) => i !== s.turn) || s.balls[0];
    ok('the loop: too soft rolls back', s.balls.some(b => b.x < -1.4 && Math.abs(b.z + 2.1) < 0.6), JSON.stringify(s.balls));
    await forceEnd();

    // Hole 3: the pond.
    await launch();
    s = await waitFor(st => st.sub === 'aim' && st.hole === 0);
    await G('_debugHole', 2);
    s = await waitFor(st => st.sub === 'aim' && st.hole === 2);
    const who = s.turn, before = s.strokes[who][2];
    await G('_debugBall', who, -4, 1.5);
    await G('_debugShoot', who, 1, 0, 0.55);
    s = await waitFor(st => st.sub === 'aim' || st.sub === 'tally', 20000);
    ok('water costs a stroke and puts the ball back', s.strokes[who][2] === before + 2 && Math.abs(s.balls[who].x + 4) < 0.05, `strokes ${before} → ${s.strokes[who][2]}, x ${s.balls[who].x}`);
    await shot('pond');
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(420000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
