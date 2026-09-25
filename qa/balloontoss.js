// ============================================================
// WATER BALLOON TOSS — the fountain park, side-on hold.
//   1. Built, and turned sideways in portrait.
//   2. Nobody tapping: the balloon bursts on the catcher, and the thrower scores.
//   3. A real tap on P1's half as it arrives catches it.
//   4. A clean exchange steps them both back.
//   5. A real tap too early bursts it.
//   6. A hard bot beats an idle player; nothing leaks; no errors.
// The balloon's clock is frozen for each timed tap: a software renderer runs
// at a few frames a second, and a real tap cannot be timed against that live.
// usage: node balloontoss.js          (screenshots: qa/shot-balloontoss-*.png)
// ============================================================
require('./stageprobe').run('balloontoss', async ({ page, ok, launch, state, shot, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const waitFor = async (fn, ms = 40000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(40); }
        return state();
    };
    // Freeze the flight at `before` s ahead of arrival, then tap P1's half.
    const tapAt = async before => {
        await G('_debugFreeze', true);
        const s = await state();
        await G('_debugFlightT', s.ball.T - before);
        await page.mouse.click(206, 700);
        await page.waitForTimeout(150);
        const after = await state();
        await G('_debugFreeze', false);
        return after;
    };

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('the park is built, turned sideways in portrait', s.gl && s.turned);

    // Round 1: P1 throws first, to an idle P2.
    s = await waitFor(st => st.sub === 'flight' && st.ball.to === 1);
    await shot('flight');
    s = await waitFor(st => st.sub === 'result');
    ok('nobody tapping: it bursts on the catcher, the thrower scores', s.score[0] === 1, `score ${s.score}`);
    await shot('splash');
    // Round 2: P2 throws to P1; a real tap too early.
    s = await waitFor(st => st.sub === 'flight' && st.ball.to === 0 && st.round === 2);
    const early = await tapAt(0.6);
    ok('a real tap too early bursts it', early.score[1] === 1 && early.sub === 'result', `score ${early.score} sub ${early.sub}`);
    await forceEnd();

    // With a bot on the far side, a full exchange.
    await launch({ bot: true, skill: 0.95 });
    s = await waitFor(st => st.sub === 'flight' && st.ball.to === 0);
    const g0 = s.gap;
    const caught = await tapAt(0.02);
    ok('a real tap on P1\'s half as it arrives catches it', caught.sub === 'hold' && caught.ball.holder === 0 && caught.score[0] === 0 && caught.score[1] === 0, JSON.stringify(caught.ball));
    ok('a clean exchange steps them both back', caught.gap > g0, `${g0} → ${caught.gap} m`);
    await page.waitForTimeout(300);
    await shot('caught');
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(180000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
