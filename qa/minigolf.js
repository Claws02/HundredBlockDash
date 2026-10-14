// ============================================================
// MINI GOLF — a real round: themed holes, turns with a follow camera, chaos.
//   1. Built in the side hold (turned in portrait); the hole flies by first and
//      a tap skips it.
//   2. TURNS: honours on the tee — P1 first. A real drag anywhere putts P1's
//      ball DOWN the hole (away from the pull) and the dotted line shows while
//      dragging; then it's P2's turn on the tee.
//   3. Away: once both have played, the ball further from the cup goes.
//   4. A slow ball over the cup drops; a fast one doesn't.
//   5. Water costs a stroke and the ball comes back to where it was played.
//   6. A ball putted into another knocks it, and the knocked ball's owner is
//      charged nothing.
//   7. The scorecard comes up when everyone's in.
//   8. CHAOS: both putt at once, each on their own strip.
//   9. Fewest strokes wins; level, countback; nothing leaks; no errors.
// usage: node minigolf.js          (screenshots: qa/shot-minigolf-*.png)
// ============================================================
require('./stageprobe').run('minigolf', async ({ page, ok, launch, state, shot, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const M = (fn, ...a) => page.evaluate(async ([fn, a]) => { const m = await import('/src/claw-core/minigames/MiniGolf.js'); return m[fn](...a); }, [fn, a]);
    const waitFor = async (fn, ms = 30000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(80); }
        return state();
    };
    // Stage (lx, ly) is at screen (412 − ly, lx) in the portrait-turned frame:
    // a pull toward the players (local +y) is a drag to the screen's left.
    const drag = async (sx, sy, dx, dy, hold = 250) => {
        await page.mouse.move(sx, sy); await page.mouse.down();
        await page.mouse.move(sx + dx / 2, sy + dy / 2, { steps: 4 });
        await page.mouse.move(sx + dx, sy + dy, { steps: 4 });
        await page.waitForTimeout(hold);
    };

    await M('_debugForceHoles', ['firstswing', 'pool', 'windmill']);
    await M('configure', { mode: 'turns' });
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('built in the side hold, turned sideways in portrait', s.gl && s.turned);
    s = await waitFor(st => st.sub === 'fly', 20000);
    ok('each hole opens with a flyover', s.sub === 'fly' && s.hole === 0);
    await page.waitForTimeout(1200);
    await shot('fly');
    await page.mouse.click(206, 446);
    s = await waitFor(st => st.sub === 'play', 4000);
    ok('a tap skips the flyover', s.sub === 'play');
    ok('turns: honours — P1 is first on the tee', s.mode === 'turns' && s.active === 0 && s.balls[0].on && !s.balls[1].on, `active ${s.active}`);
    await page.waitForTimeout(1300);
    await shot('tee');

    // 2. A real drag: pull back toward the players, let go.
    const x0 = s.balls[0].x;
    await drag(260, 446, -90, 0);
    const mid = await state();
    ok('dragging shows the dotted line of the shot', mid.aiming[0] && mid.dots[0] > 4, `dots ${mid.dots[0]}`);
    await shot('aim');
    await page.mouse.up();
    await page.waitForTimeout(250);
    s = await state();
    ok('the drag putts P1 down the hole, away from the pull', s.strokes[0][0] === 1 && s.balls[0].x > x0 + 0.3, `x ${x0} → ${s.balls[0].x}, strokes ${s.strokes[0][0]}`);
    await page.waitForTimeout(400);
    await shot('roll');
    s = await waitFor(st => st.active === 1 && st.turn === 'aim', 15000);
    ok('then it is P2 on the tee', s.active === 1 && s.balls[1].on, `active ${s.active}`);
    const lineP1 = s.balls[0];

    // 3. Away. P2 putts a short one; P1's ball is further on, so P2 (further away) again.
    await G('_debugShoot', 1, 1, 0, 0.12);
    s = await waitFor(st => st.turn === 'aim' && st.strokes[1][0] === 1, 15000);
    const away = s.balls[0].x < s.balls[1].x ? 0 : 1;
    ok('away: the ball further from the cup goes next', s.active === away, `P1 x ${s.balls[0].x}, P2 x ${s.balls[1].x}, active ${s.active}`);

    // 4. The cup: a firm putt from close runs over; a gentle one drops.
    const [cx, cz] = s.cup;
    await G('_debugBall', s.active, cx - 1.2, cz);
    const fast = await G('_debugSim', s.active, 1, 0, 0.9);
    const slow = await G('_debugSim', s.active, 1, 0, 0.17);
    ok('a fast ball runs over the cup, a slow one drops', fast.result !== 'cup' && slow.result === 'cup', `fast ${fast.result}, slow ${slow.result}`);
    const who = s.active;
    await G('_debugShoot', who, 1, 0, 0.17);
    s = await waitFor(st => st.balls[who].holed, 6000);
    await page.waitForTimeout(300);
    await shot('cup');
    ok('a slow putt over the cup drops in', s.balls[who].holed, JSON.stringify(s.balls[who]));
    // The other one holes out too, and the card comes up.
    const other = 1 - who;
    s = await waitFor(st => st.active === other && st.turn === 'aim', 12000);
    await G('_debugBall', other, cx - 1.0, cz);
    await G('_debugShoot', other, 1, 0, 0.15);
    s = await waitFor(st => st.sub === 'card', 12000);
    ok('the scorecard comes up when everyone is in', s.sub === 'card' && s.card, `sub ${s.sub}`);
    await page.waitForTimeout(500);
    await shot('card');
    await G('_debugSkip');

    // 5. Water: hole 2 is the paddling pool. Off the side of the bridge.
    s = await waitFor(st => st.hole === 1 && st.sub === 'fly', 10000);
    await G('_debugSkip');
    s = await waitFor(st => st.sub === 'play' && st.turn === 'aim', 6000);
    const pw = s.active;
    await G('_debugBall', pw, 7.0, 0);
    const before = (await state()).strokes[pw][1];
    await G('_debugShoot', pw, 0.3, 1, 0.55);
    s = await waitFor(st => st.strokes[pw][1] >= before + 2, 6000);
    await page.waitForTimeout(200);
    s = await state();
    ok('water costs a stroke, and the ball comes back', s.strokes[pw][1] === before + 2 && Math.abs(s.balls[pw].x - 7.0) < 0.05 && Math.abs(s.balls[pw].z) < 0.05,
       `strokes ${before} → ${s.strokes[pw][1]}, ball ${s.balls[pw].x},${s.balls[pw].z}`);

    // 6. Knock: the other ball sits in the way.
    s = await waitFor(st => st.turn === 'aim', 10000);
    const kA = s.active, kB = 1 - kA;
    await G('_debugBall', kB, 3.0, 1.0);
    const sb = (await state()).strokes[kB][1];
    await G('_debugBall', kA, 1.0, 1.0);
    await G('_debugShoot', kA, 1, 0, 0.35);
    s = await waitFor(st => st.balls[kB].x > 3.2, 4000);
    ok('a ball putted into another knocks it, at no stroke to its owner', s.balls[kB].x > 3.2 && s.strokes[kB][1] === sb, `x 3.0 → ${s.balls[kB].x}, strokes ${sb} → ${s.strokes[kB][1]}`);
    await shot('knock');

    // 9. The card and the winner: P2 the fewer strokes.
    await G('_debugScore', [[3, 4, 3], [2, 3, 3]], [[5, 5, 5], [5, 5, 5]]);
    let r = await waitResult(15000);
    ok('fewest strokes wins', r && r.winner === 1, JSON.stringify(r));
    await cleanup();

    // Countback when level: the better last hole wins.
    await M('_debugForceHoles', ['firstswing', 'sandpit', 'skate']);
    await launch();
    await waitFor(st => st.phase === 'play', 15000);
    await G('_debugScore', [[2, 3, 2], [3, 2, 2]], [[5, 5, 5], [5, 5, 5]]);
    r = await waitResult(15000);
    ok('level on strokes: countback from the last hole', r && r.winner === 1, JSON.stringify(r));
    await cleanup();

    // 8. CHAOS: both at once, each on their own strip (P1 the bottom of the glass).
    await M('configure', { mode: 'chaos' });
    await M('_debugForceHoles', ['sprinkler']);
    await launch();
    s = await waitFor(st => st.sub === 'fly', 20000);
    await G('_debugSkip');
    s = await waitFor(st => st.sub === 'play', 5000);
    ok('chaos: every ball on the tee at once', s.mode === 'chaos' && s.balls.every(b => b.on && b.state === 'aim'));
    await page.waitForTimeout(1500);
    const cx0 = (await state()).balls.map(b => b.x);
    // Pull back toward the tee end (the glass's top in portrait): the ball goes on down the hole.
    await page.mouse.move(206, 700); await page.mouse.down(); await page.mouse.move(206, 610, { steps: 5 }); await page.mouse.up();
    await page.mouse.move(206, 300); await page.mouse.down(); await page.mouse.move(206, 210, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(300);
    s = await state();
    await shot('chaos');
    ok('chaos: both putt at the same time, each on their own strip', s.strokes[0][0] === 1 && s.strokes[1][0] === 1 && s.balls.every((b, i) => b.x > cx0[i] + 0.2),
       `strokes ${s.strokes.map(x => x[0])} x ${cx0} → ${s.balls.map(b => b.x)}`);
    await M('configure', { mode: 'turns' });
    await page.evaluate(async () => { const MM = await import('/src/claw-core/minigames/MinigameManager.js'); MM.forceEndMinigame(); });
    await page.waitForTimeout(300);

    // A hard bot round against an idle player, one hole: the bot holes out.
    await M('_debugForceHoles', ['firstswing']);
    await launch({ bot: true, skill: 0.9 });
    s = await waitFor(st => st.balls[1].holed || st.phase === 'over', 90000);
    ok('a bot plays its turns and holes out', s.balls[1].holed, JSON.stringify(s));
    await page.evaluate(async () => { const MM = await import('/src/claw-core/minigames/MinigameManager.js'); MM.forceEndMinigame(); });
    await page.waitForTimeout(300);
    await cleanup();
    await M('_debugForceHoles', null);
});
