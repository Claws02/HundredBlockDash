// ============================================================
// HOT POTATO (bombpass) — the works yard, one shared overhead camera.
//   1. Built in the face-off hold; a round is served.
//   2. A tap during the serve's hang is ignored (no lockout).
//   3. A real tap on P1's half with the bomb on P1's side bats it back, faster.
//   4. A tap with the bomb on the OTHER side is a whiff and locks you out.
//   5. Reaching a player blows up on them; the fuse running out blows up on
//      whoever's side it is.
//   6. A hard bot beats an idle player 3–0; no leaks, no errors.
// usage: node bombpass.js          (screenshots: qa/shot-bombpass-*.png)
// ============================================================
require('./stageprobe').run('bombpass', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 8000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(40); }
        return state();
    };
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const tapP1 = () => page.mouse.click(206, 720);

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('built in the face-off hold', s.gl && !s.turned);
    await waitPhase('live', 30000);
    await G('_debugFreeze', true);
    await tapP1();
    s = await state();
    ok('a tap during the serve\'s hang is ignored', s.lock[0] === 0 && s.bomb.rallies === 0, JSON.stringify(s));
    await shot('serve');

    await G('_debugBomb', 2.2, 3, 8);
    await tapP1();
    s = await state();
    ok('a tap with the bomb on your side bats it back, faster', s.bomb.vz < -2.75 && s.bomb.rallies === 1, JSON.stringify(s.bomb));
    await shot('return');

    await G('_debugBomb', -2, -3, 8);
    await tapP1();
    s = await state();
    ok('a tap with it on their side is a whiff and locks you out', s.lock[0] > 0.1 && s.bomb.rallies === 1, `lock ${s.lock[0]}`);
    await page.waitForTimeout(500);

    await G('_debugBomb', 3.8, 4, 8);
    await G('_debugFreeze', false);
    s = await waitFor(st => st.phase === 'blast');
    await page.waitForTimeout(150);
    await shot('boom');
    ok('reaching P1 blows up on P1', s.loser === 0 && s.wins[1] === 1, `loser ${s.loser} wins ${s.wins}`);

    s = await waitFor(st => st.phase === 'live' && st.round === 1, 8000);
    await G('_debugBomb', -1.5, 0.001, 0.05);
    s = await waitFor(st => st.phase === 'blast');
    ok('the fuse running out blows up on whoever\'s side it is', s.loser === 1 && s.wins[0] === 1, `loser ${s.loser} wins ${s.wins}`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(120000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
