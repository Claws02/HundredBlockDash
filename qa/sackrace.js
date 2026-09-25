// ============================================================
// SACK RACE — the hay meadow, side-on.
//   1. Built in the side hold (turned in portrait).
//   2. A real tap hops P1.
//   3. A tap as the ring closes (the landing window) chains the next hop.
//   4. A late tap starts the chain again from a shuffle.
//   5. Two taps in the air: faceplant.
//   6. A bale bounces a low hop; a chained hop (2+) clears it.
//   7. Landing past the flag wins; a hard bot beats an idle player and
//      reaches the flag (no deadlock at the bales); no leaks, no errors.
// usage: node sackrace.js          (screenshots: qa/shot-sackrace-*.png)
// ============================================================
require('./stageprobe').run('sackrace', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 8000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(40); }
        return state();
    };
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const tapP1 = () => page.mouse.click(206, 700);

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('built in the side hold, turned in portrait', s.gl && s.turned);
    await waitPhase('race', 30000);

    await tapP1();
    s = await waitFor(st => st.racers[0].hops === 1);
    ok('a real tap hops P1', s.racers[0].hops === 1 && (s.racers[0].hop || s.racers[0].x > -18.6), JSON.stringify(s.racers[0]));

    // On the beat: freeze in the air inside the landing window, tap, release.
    await waitFor(st => !st.racers[0].hop);
    await tapP1();
    await waitFor(st => !!st.racers[0].hop);
    await G('_debugFreeze', true);
    await G('_debugHopT', 0, 0.36);
    await tapP1();
    s = await state();
    const queued = s.racers[0].hop && s.racers[0].hop.queued;
    await shot('beat');
    await G('_debugFreeze', false);
    s = await waitFor(st => st.racers[0].streak === 1 && !!st.racers[0].hop);
    ok('a tap as the ring closes chains the next hop', queued && s.racers[0].streak === 1, `queued ${queued} streak ${s.racers[0].streak}`);

    // Late: let it land and sit, then tap.
    await waitFor(st => !st.racers[0].hop);
    await page.waitForTimeout(600);
    await tapP1();
    s = await waitFor(st => !!st.racers[0].hop);
    ok('a late tap starts the chain again', s.racers[0].streak === 0, `streak ${s.racers[0].streak}`);

    // Too fast: two taps early in the air.
    await G('_debugFreeze', true);
    await G('_debugHopT', 0, 0.08);
    await tapP1(); await tapP1();
    s = await state();
    const planted = s.racers[0].hop && s.racers[0].hop.plant;
    await G('_debugFreeze', false);
    s = await waitFor(st => st.racers[0].plant > 0);
    await shot('faceplant');
    ok('two taps in the air: faceplant', planted && s.racers[0].plant > 0, `plant ${s.racers[0].plant} streak ${s.racers[0].streak}`);
    await waitFor(st => st.racers[0].plant === 0, 4000);

    // Bales at x = -9: a shuffle bounces off, a chain of two clears it.
    await G('_debugPlace', 0, -10.3, 0);
    await G('_debugLaunch', 0, false);
    s = await state();
    const blocked = s.racers[0].hop && s.racers[0].hop.blocked === -9;
    s = await waitFor(st => st.racers[0].bump > 0);
    ok('a low hop bounces off a bale', blocked && s.racers[0].x < -9.45, `x ${s.racers[0].x}`);
    await waitFor(st => st.racers[0].bump === 0, 3000);
    await G('_debugPlace', 0, -10.3, 1);
    await G('_debugLaunch', 0, true);
    await page.waitForTimeout(120);
    await shot('bale');
    s = await waitFor(st => !st.racers[0].hop);
    ok('a chained hop clears it', s.racers[0].x > -8.5 && s.racers[0].streak === 2, `x ${s.racers[0].x} streak ${s.racers[0].streak}`);

    await G('_debugPlace', 0, 17.3, 3);
    await G('_debugLaunch', 0, true);
    s = await waitFor(st => st.winner >= 0, 5000);
    ok('landing past the flag wins', s.winner === 0, `winner ${s.winner} x ${s.racers[0].x}`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false, botFlag = false;
    const r = await waitResult(240000, async () => {
        const st = await state();
        if (st && st.racers && st.racers[1].finished) botFlag = true;
        if (st && st.phase === 'race' && st.clock > 4 && st.clock < 4.3) await shot('race');
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player, over the bales to the flag', !!r && r.winner === 1 && botFlag, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s flag ${botFlag}` : 'timed out');

    // A weak bot must still get over the bales.
    await launch({ bot: true, p1bot: true, skill: 0.2 });
    let weakFlag = false;
    const r2 = await waitResult(240000, async () => {
        const st = await state();
        if (st && st.racers && (st.racers[0].finished || st.racers[1].finished)) weakFlag = true;
    });
    ok('two weak bots still reach the flag', !!r2 && weakFlag, r2 ? `winner=${r2.winner} in ${(r2.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
