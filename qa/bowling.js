// ============================================================
// BOWLING — the neon lanes, face-off hold, split screen.
//   1. Built with physics; two views once play starts.
//   2. The scoring is a real bowling card (strikes, spares, the last frame).
//   3. A real flick up P1's half sends the ball down the lane.
//   4. A good ball into the rack knocks real pins down, and they are counted.
//   5. A ball off the edge goes in the gutter and scores nothing.
//   6. The curve is spin: a swipe that turns off to your right hooks the ball
//      to your LEFT, and the other way round (read from the raw finger path).
//   7. No shot clock: an untouched ball just waits.
//   8. Frames are played together: a lane that finishes a frame waits for the
//      other, so both players bowl both frames; level after two frames, a
//      tie-break frame decides it.
//   9. A hard bot beats a player who only rolls gutters; nothing leaks; no errors.
// usage: node bowling.js          (screenshots: qa/shot-bowling-*.png)
// ============================================================
require('./stageprobe').run('bowling', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const waitFor = async (fn, ms = 40000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(60); }
        return state();
    };
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    await waitPhase('play', 30000);
    let s = await state();
    ok('built with physics; split screen once play starts', s.gl && s.physics && s.views === 2, `views ${s.views} physics ${s.physics}`);

    const cards = await Promise.all([
        G('_debugScore', [10, 10, 10, 10]), G('_debugScore', [7, 3, 5, 2]), G('_debugScore', [3, 4, 2, 1]),
        G('_debugScore', [10, 3, 4]), G('_debugScore', [6, 4, 10, 7, 2]),
    ]);
    ok('scoring is a real card: 60 / 22 / 10 / 24 / 39', JSON.stringify(cards) === JSON.stringify([60, 22, 10, 24, 39]), JSON.stringify(cards));

    s = await waitFor(st => st.lanes[0].sub === 'aim');
    // A real flick: quick, straight up the bottom half.
    await page.mouse.move(200, 830); await page.mouse.down();
    await page.mouse.move(200, 700, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    s = await state();
    ok('a real flick up P1\'s half sends the ball down the lane', s.lanes[0].sub === 'roll' && s.lanes[0].ball.v > 3, JSON.stringify(s.lanes[0].ball));
    await shot('roll');
    s = await waitFor(st => st.lanes[0].rolls.length >= 1, 30000);
    await shot('pins');
    ok('the ball is counted', s.lanes[0].rolls.length === 1, JSON.stringify(s.lanes[0].rolls));
    await forceEnd();

    // Direction, from each player's own end. P1's right is world +x (lane at
    // +1.45); P2 plays from the far end, so their right is world −x (lane at −1.45).
    await launch();
    await waitPhase('play', 30000);
    await waitFor(st => st.lanes[0].sub === 'aim' && st.lanes[1].sub === 'aim');
    // P2 lines up first: holding a drag to THEIR right (the stage's left) slides their ball that way.
    await page.mouse.move(206, 150); await page.mouse.down();
    await page.mouse.move(120, 150, { steps: 3 });
    await page.waitForTimeout(500);
    s = await state();
    await page.mouse.up();
    ok('dragging sideways lines the ball up, before any throw', s.lanes[1].sub === 'aim' && s.lanes[1].ball.x < -1.6, `P2 ball x ${s.lanes[1].ball.x} (lane −1.45)`);
    const lined = s.lanes[1].ball.x;
    await page.mouse.move(206, 800); await page.mouse.down(); await page.mouse.move(226, 740); await page.mouse.move(246, 680); await page.mouse.up();
    await page.mouse.move(206, 92); await page.mouse.down(); await page.mouse.move(186, 152); await page.mouse.move(166, 212); await page.mouse.up();
    await page.waitForTimeout(700);
    s = await state();
    ok('P1 flicks up-and-right: the ball goes to P1\'s right', s.lanes[0].ball.x > 1.6, `x ${s.lanes[0].ball.x}`);
    ok('P2 flicks to their right: the ball goes to P2\'s right, from where they lined up', s.lanes[1].ball.x < lined - 0.1, `x ${lined} → ${s.lanes[1].ball.x}`);
    await forceEnd();

    // A curve is spin: the swipe's chord is straight up the lane, and only the
    // bend decides the hook. Turning off to the right at the end → hooks LEFT.
    const curve = async pts => {
        await launch();
        await waitPhase('play', 30000);
        await waitFor(st => st.lanes[0].sub === 'aim');
        await page.mouse.move(206, 800); await page.mouse.down();
        for (const [x, y] of pts) await page.mouse.move(x, y);
        await page.mouse.up();
        let far = 1.45, st;
        for (let i = 0; i < 60; i++) { st = await state(); if (st.lanes[0].ball) far = st.lanes[0].ball.x; if (st.lanes[0].sub !== 'roll' && i > 3) break; await page.waitForTimeout(60); }
        await forceEnd();
        return far;
    };
    const turnRight = await curve([[206, 780], [206, 760], [206, 740], [206, 720], [210, 705], [220, 694], [236, 686]]);
    ok('a swipe that turns off to your right hooks the ball to your LEFT', turnRight < 1.3, `ball ends at x ${turnRight} (lane 1.45, P1's left is −x)`);
    const turnLeft = await curve([[206, 780], [206, 760], [206, 740], [206, 720], [202, 705], [192, 694], [176, 686]]);
    ok('…and one that turns off to your left hooks it to your RIGHT', turnLeft > 1.6, `ball ends at x ${turnLeft}`);

    // No shot clock: leave P1's ball alone well past the old 9 s limit.
    await launch();
    await waitPhase('play', 30000);
    await waitFor(st => st.lanes[0].sub === 'aim');
    await page.waitForTimeout(11000);
    s = await state();
    ok('no shot clock: an untouched ball just waits', s.lanes[0].sub === 'aim' && s.lanes[0].rolls.length === 0, `${s.lanes[0].sub} rolls ${JSON.stringify(s.lanes[0].rolls)}`);
    await forceEnd();

    // Both players bowl both frames, then a tie-break when level.
    await launch();
    await waitPhase('play', 30000);
    const bowlOut = async (slot, n, aim = 0.12) => {
        for (let k = 0; k < n; k++) {
            const st = await waitFor(x => x.lanes[slot].sub === 'aim' || x.lanes[slot].sub === 'wait', 30000);
            if (st.lanes[slot].sub !== 'aim') return;
            const len = st.lanes[slot].rolls.length + st.lanes[slot].tb.length;
            await G('_debugBowl', slot, aim, 0.6, 0);
            await waitFor(x => x.lanes[slot].rolls.length + x.lanes[slot].tb.length > len, 30000);
        }
    };
    await bowlOut(0, 2);                                     // P1 finishes frame 1…
    s = await waitFor(st => st.lanes[0].sub === 'wait', 5000);
    ok('a lane that finishes a frame waits for the other lane', s.lanes[0].sub === 'wait' && s.frameNo === 0 && s.lanes[1].sub === 'aim', `P1 ${s.lanes[0].sub} P2 ${s.lanes[1].sub} frame ${s.frameNo}`);
    await shot('waiting');
    await bowlOut(1, 2);                                     // …then P2 does, and frame 2 starts for both
    s = await waitFor(st => st.frameNo === 1 && st.lanes.every(L => L.sub === 'aim'), 8000);
    ok('then frame 2 starts for BOTH players', s.frameNo === 1 && s.lanes.every(L => L.sub === 'aim'), `frame ${s.frameNo} ${s.lanes.map(L => L.sub)}`);
    await bowlOut(1, 2); await bowlOut(0, 2);                // all gutters: level on 0
    s = await waitFor(st => st.frameNo === 2 && st.lanes.every(L => L.sub === 'aim'), 8000);
    await page.waitForTimeout(300);
    await shot('tiebreak');
    ok('both bowled two frames; level, so a tie-break frame', s.frameNo === 2 && s.lanes.every(L => L.rolls.length === 4) && s.phase === 'play', `frame ${s.frameNo} rolls ${s.lanes.map(L => L.rolls.length)} phase ${s.phase}`);
    await bowlOut(0, 2, 0.011); await bowlOut(1, 2);
    const rt = await waitResult(20000);
    ok('the tie-break frame decides it', !!rt && rt.winner === 0, rt ? `winner ${rt.winner}` : 'no result');

    // A good ball, from code, into the pocket: real pins fall.
    await launch();
    await waitPhase('play', 30000);
    s = await waitFor(st => st.lanes[0].sub === 'aim');
    await G('_debugBowl', 0, 0.011, 0.95, 0);
    s = await waitFor(st => st.lanes[0].rolls.length >= 1, 30000);
    ok('a good ball into the rack knocks real pins down', s.lanes[0].rolls[0] >= 6, `down ${s.lanes[0].rolls[0]} · ${s.lanes[0].msg}`);
    await shot('strike');
    // A ball aimed off the edge: gutter. (A strike ends P1's frame, so P2 finishes theirs first.)
    await bowlOut(1, 2);
    s = await waitFor(st => st.lanes[0].sub === 'aim');
    const before = s.lanes[0].rolls.length;
    await G('_debugBowl', 0, 0.12, 0.6, 0);
    s = await waitFor(st => st.lanes[0].rolls.length > before, 30000);
    ok('a ball off the edge goes in the gutter and scores nothing', s.lanes[0].rolls[before] === 0, JSON.stringify(s.lanes[0]));
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(300000, async () => {
        const st = await state();
        if (st && st.phase === 'play' && st.lanes[0].sub === 'aim') await G('_debugBowl', 0, 0.12, 0.6, 0);
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats a player who only rolls gutters', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
