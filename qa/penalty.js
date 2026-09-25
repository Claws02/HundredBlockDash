// ============================================================
// PENALTY SHOOTOUT — the stadium, split screen, one shoots and one keeps.
//   1. Built; two views once the first kick is set; P1 shoots first.
//   2. No shot clock: left alone, the kick is not taken for you.
//   3. The aim ring is drawn by the shooter's camera only.
//   4. A real pull back on P1's half sets power and aim (pull left → right),
//      and letting go strikes it.
//   5. The keeper can still move once the ball is struck (a real drag).
//   6. The four outcomes: GOAL, SAVED, OVER THE BAR, OFF THE POST.
//   7. Two bots play a whole shootout inside the arcade's time budget;
//      no leaks, no errors.
// usage: node penalty.js          (screenshots: qa/shot-penalty-*.png)
// ============================================================
require('./stageprobe').run('penalty', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 8000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(40); }
        return state();
    };
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const nextAim = kick => waitFor(st => st.phase === 'aim' && st.kick === kick, 15000);

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    await waitPhase('aim', 30000);
    let s = await state();
    ok('split screen once the first kick is set; P1 shoots', s.gl && s.views === 2 && s.shooter === 0, `views ${s.views} shooter ${s.shooter}`);
    ok('only the shooter\'s camera draws the aim ring', s.cams[0].reticle && !s.cams[1].reticle, JSON.stringify(s.cams));

    await page.waitForTimeout(6000);
    s = await state();
    ok('no shot clock: the kick is not taken for you', s.phase === 'aim' && s.kick === 0, `${s.phase} kick ${s.kick}`);

    // A real pull: down and to the left on P1's half.
    await page.mouse.move(206, 640); await page.mouse.down();
    await page.mouse.move(150, 760, { steps: 5 });
    await page.waitForTimeout(200);
    s = await state();
    await shot('pull');
    const pulled = { power: s.power, x: s.aim.x };
    await page.mouse.up();
    s = await waitFor(st => st.phase !== 'aim');
    ok('a pull back sets power, pulling left aims right, and letting go strikes',
       pulled.power > 0.3 && pulled.x > 0.5 && (s.phase === 'flight' || s.phase === 'settle'), `${JSON.stringify(pulled)} → ${s.phase}`);
    await shot('flight');

    // Kick 2: P2 shoots, P1 keeps. A soft shot, then a real drag by the keeper.
    await nextAim(1);
    await G('_debugShoot', 0.5, 0);
    await page.mouse.move(60, 800); await page.mouse.down();
    const k0 = (await state()).keeper;
    await page.mouse.move(360, 800, { steps: 4 });
    await page.waitForTimeout(250);
    s = await state();
    await page.mouse.up();
    // The keeper only moves in flight, so any travel here happened after the strike.
    ok('the keeper can still move once the ball is struck', Math.abs(s.keeper - k0) > 0.1, `${k0} → ${s.keeper} (${s.phase})`);
    await shot('dive');

    const outcome = async (kick, x, power, k) => {
        await nextAim(kick);
        if (k != null) await G('_debugKeeper', k);
        await G('_debugShoot', x, power);
        const st = await waitFor(t => t.hist.length > kick, 6000);
        return st.hist[kick] ? st.hist[kick].outcome : 'none';
    };
    const before = (await state()).score.slice();
    let o = await outcome(2, 0.2, 0.4, 0.2);
    s = await state();
    ok('a shot the keeper cannot reach is a GOAL, and it counts', o === 'GOAL' && s.score[0] === before[0] + 1, `${o} ${JSON.stringify(before)} → ${JSON.stringify(s.score)}`);
    await page.waitForTimeout(300);
    await shot('goal');
    o = await outcome(3, 0.3, 0.3, 0.7);
    ok('a shot at the keeper is SAVED', o === 'SAVED', o);
    o = await outcome(4, 0.5, 1, 0.9);
    ok('the hardest strike clears the bar', o === 'OVER', o);
    o = await outcome(5, 0.995, 0.3, 0.5);
    ok('too near a post hits the woodwork', o === 'POST', o);
    await forceEnd();

    await launch({ bot: true, p1bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(120000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('two bots play a whole shootout inside the time budget', !!r && r.ms / 1000 <= 65, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
