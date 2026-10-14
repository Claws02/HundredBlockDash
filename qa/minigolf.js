// ============================================================
// MINI GOLF — a real round: themed holes, turns with a follow camera, chaos.
//   1. TURNS is upright (passed round); the hole flies by first and a tap
//      skips it.
//   2. TURNS: honours on the tee — P1 first, on a PASS TO card that a tap
//      takes. A real drag DOWN the screen putts P1's ball up the hole (away
//      from the pull) and the dotted line shows while dragging; then the card
//      passes it to P2 on the tee.
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
    // Turns is upright: the stage is the screen. Chaos is turned: stage (lx, ly)
    // is at screen (412 − ly, lx).
    // Whoever's up takes the phone (the PASS TO card), if it's showing.
    const take = async () => { const st = await state(); if (st.turn === 'pass') await G('_debugTakePass'); return state(); };
    const upNext = (ms = 15000) => waitFor(st => st.turn === 'aim' || st.turn === 'pass', ms).then(take);
    const drag = async (sx, sy, dx, dy, hold = 250) => {
        await page.mouse.move(sx, sy); await page.mouse.down();
        await page.mouse.move(sx + dx / 2, sy + dy / 2, { steps: 4 });
        await page.mouse.move(sx + dx, sy + dy, { steps: 4 });
        await page.waitForTimeout(hold);
    };

    await M('_debugForceHoles', ['windmill', 'pool', 'bunker']);
    await M('configure', { mode: 'turns', round: true });
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('turns: built upright, not turned', s.gl && !s.turned);
    s = await waitFor(st => st.sub === 'fly', 20000);
    ok('each hole opens with a flyover', s.sub === 'fly' && s.hole === 0);
    await page.waitForTimeout(1200);
    await shot('fly');
    await page.mouse.click(206, 446);
    s = await waitFor(st => st.sub === 'play', 4000);
    ok('a tap skips the flyover', s.sub === 'play');
    ok('turns: honours — P1 is first on the tee', s.mode === 'turns' && s.active === 0 && s.balls[0].on && !s.balls[1].on, `active ${s.active}`);
    ok('the PASS TO card shows for P1 first', s.turn === 'pass' && s.pass === 0, `turn ${s.turn} pass ${s.pass}`);
    await page.waitForTimeout(500);
    await shot('pass');
    await page.mouse.click(206, 446);
    await page.waitForTimeout(300);
    s = await state();
    ok('a tap takes the phone', s.turn === 'aim' && s.pass === -1, `turn ${s.turn}`);
    await page.waitForTimeout(1300);
    await shot('tee');

    // 2. A real drag: pull back down the screen, let go.
    const x0 = s.balls[0].x;
    await drag(206, 520, 0, 95);
    const mid = await state();
    ok('dragging shows the dotted line of the shot', mid.aiming[0] && mid.dots[0] > 4, `dots ${mid.dots[0]}`);
    await shot('aim');
    // Changed your mind: back to where the drag started, and let go — no shot.
    await page.mouse.move(206, 522, { steps: 4 });
    await page.waitForTimeout(150);
    const ring = await page.evaluate(() => [...document.querySelectorAll('#minigame-layer div')].some(e => e.textContent === '✕NO SHOT' && e.style.opacity === '1'));
    await shot('cancel');
    await page.mouse.up();
    await page.waitForTimeout(400);
    s = await state();
    ok('drag back to the start: the ✕ shows, and letting go plays nothing', ring && s.strokes[0][0] === 0 && Math.abs(s.balls[0].x - x0) < 0.01 && s.turn === 'aim', `ring ${ring} strokes ${s.strokes[0][0]} turn ${s.turn}`);
    await drag(206, 520, 0, 95);
    await page.mouse.up();
    await page.waitForTimeout(250);
    s = await state();
    ok('the drag putts P1 down the hole, away from the pull', s.strokes[0][0] === 1 && s.balls[0].x > x0 + 0.3, `x ${x0} → ${s.balls[0].x}, strokes ${s.strokes[0][0]}`);
    await page.waitForTimeout(400);
    await shot('roll');
    s = await waitFor(st => st.active === 1 && (st.turn === 'aim' || st.turn === 'pass'), 15000);
    ok('then the phone is passed to P2, on the tee', s.active === 1 && s.balls[1].on && s.pass === 1, `active ${s.active} pass ${s.pass}`);
    s = await take();
    const lineP1 = s.balls[0];

    // 3. Away. P2 putts a short one; P1's ball is further on, so P2 (further away) again.
    await G('_debugShoot', 1, 1, 0, 0.12);
    s = await waitFor(st => (st.turn === 'aim' || st.turn === 'pass') && st.strokes[1][0] === 1, 15000);
    s = await take();
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
    s = await waitFor(st => st.active === other && (st.turn === 'aim' || st.turn === 'pass'), 12000);
    await take();
    await G('_debugBall', other, cx - 1.0, cz);
    await G('_debugShoot', other, 1, 0, 0.15);
    s = await waitFor(st => st.sub === 'card', 12000);
    ok('the scorecard comes up when everyone is in', s.sub === 'card' && s.card, `sub ${s.sub}`);
    await page.waitForTimeout(500);
    await shot('card');
    await G('_debugSkip');

    // 5. Water: hole 2 is the paddling pool. Off the side of the first bridge.
    s = await waitFor(st => st.hole === 1 && st.sub === 'fly', 10000);
    await G('_debugSkip');
    s = await waitFor(st => st.sub === 'play' && (st.turn === 'aim' || st.turn === 'pass'), 6000);
    s = await take();
    const pw = s.active;
    await G('_debugBall', pw, 10.0, 0);
    const before = (await state()).strokes[pw][1];
    await G('_debugShoot', pw, 0.3, 1, 0.55);
    s = await waitFor(st => st.strokes[pw][1] >= before + 2, 6000);
    await page.waitForTimeout(200);
    s = await state();
    ok('water costs a stroke, and the ball comes back', s.strokes[pw][1] === before + 2 && Math.abs(s.balls[pw].x - 10.0) < 0.05 && Math.abs(s.balls[pw].z) < 0.05,
       `strokes ${before} → ${s.strokes[pw][1]}, ball ${s.balls[pw].x},${s.balls[pw].z}`);

    // 6. Knock: the other ball sits in the way.
    s = await upNext(10000);
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
    await M('_debugForceHoles', ['windmill', 'bunker', 'skate']);
    await M('configure', { round: true });
    await launch();
    await waitFor(st => st.phase === 'play', 15000);
    await G('_debugScore', [[2, 3, 2], [3, 2, 2]], [[5, 5, 5], [5, 5, 5]]);
    r = await waitResult(15000);
    ok('level on strokes: countback from the last hole', r && r.winner === 1, JSON.stringify(r));
    await cleanup();

    // 8. CHAOS: both at once, upright, the screen split across the middle (P1 the bottom half).
    await M('configure', { mode: 'chaos' });
    await M('_debugForceHoles', ['sprinkler']);
    await launch();
    s = await waitFor(st => st.sub === 'fly', 20000);
    await G('_debugSkip');
    s = await waitFor(st => st.sub === 'play', 5000);
    ok('chaos: upright, every ball on the tee at once', s.mode === 'chaos' && !s.turned && s.balls.every(b => b.on && b.state === 'aim'));
    await page.waitForTimeout(1500);
    const cx0 = (await state()).balls.map(b => b.x);
    // Pull back down the screen (toward the tee) in your own half: the ball goes on up the hole.
    await page.mouse.move(206, 600); await page.mouse.down(); await page.mouse.move(206, 690, { steps: 5 }); await page.mouse.up();
    await page.mouse.move(206, 200); await page.mouse.down(); await page.mouse.move(206, 290, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(300);
    s = await state();
    await shot('chaos');
    ok('chaos: both putt at the same time, each in their own half', s.strokes[0][0] === 1 && s.strokes[1][0] === 1 && s.balls.every((b, i) => b.x > cx0[i] + 0.2),
       `strokes ${s.strokes.map(x => x[0])} x ${cx0} → ${s.balls.map(b => b.x)}`);
    await M('configure', { mode: 'turns' });
    await page.evaluate(async () => { const MM = await import('/src/claw-core/minigames/MinigameManager.js'); MM.forceEndMinigame(); });
    await page.waitForTimeout(300);

    // A party's golf (no Mini Golf mode round) is always chaos, whatever the saved mode.
    await M('_debugForceHoles', ['bunker']);
    await launch();
    s = await waitFor(st => st.phase === 'play', 20000);
    ok('a party\'s golf is chaos even with turns saved', s.mode === 'chaos', `${s.mode} turned=${s.turned}`);
    await page.evaluate(async () => { const MM = await import('/src/claw-core/minigames/MinigameManager.js'); MM.forceEndMinigame(); });
    await page.waitForTimeout(300);

    // A hard bot round against an idle player, one hole: the bot holes out.
    await M('_debugForceHoles', ['bunker']);
    await M('configure', { round: true });
    await launch({ bot: true, skill: 0.9 });
    s = await waitFor(st => st.balls[1].holed || st.phase === 'over', 180000);
    ok('a bot plays its turns and holes out', s.balls[1].holed, JSON.stringify(s));
    await page.evaluate(async () => { const MM = await import('/src/claw-core/minigames/MinigameManager.js'); MM.forceEndMinigame(); });
    await page.waitForTimeout(300);
    await cleanup();
    await M('_debugForceHoles', null);
});
