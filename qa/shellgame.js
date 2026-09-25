// ============================================================
// SHELL GAME — the midway booth, face-off, one table.
//   1. Built in the face-off hold; a round shows the pea, shuffles, asks.
//   2. A real tap on P1's button for the pea's cup scores; a wrong one doesn't.
//   3. P2's buttons read the table from their end (mirrored).
//   4. No pick before the clock runs out is a miss.
//   5. Later rounds shuffle longer and faster.
//   6. A hard bot beats an idle player; no leaks, no errors.
// usage: node shellgame.js          (screenshots: qa/shot-shellgame-*.png)
// ============================================================
require('./stageprobe').run('shellgame', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(50); }
        return state();
    };
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const tapPad = async (slot, k) => { const p = await G('_debugPad', slot, k); await page.mouse.click(p.x, p.y); };

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('built in the face-off hold', s.gl && !s.turned);
    s = await waitFor(st => st.sub === 'shuffle', 30000);
    await page.waitForTimeout(200);
    await shot('shuffle');
    s = await waitFor(st => st.sub === 'pick', 30000);
    const r1 = { swaps: s.swaps, dur: s.dur };
    await G('_debugFreeze', true);
    await shot('pick');
    const ans = s.answer;
    await tapPad(0, ans);                                   // P1: their left is the table's left
    const wrongPos = (ans + 1) % 3;
    await tapPad(1, 2 - wrongPos);                          // P2: mirrored
    await G('_debugFreeze', false);
    s = await waitFor(st => st.sub === 'reveal');
    await page.waitForTimeout(500);
    await shot('reveal');
    ok('a right pick scores, a wrong one does not', s.score[0] === 1 && s.score[1] === 0 && s.picks[0] === ans && s.picks[1] === wrongPos,
       `answer ${ans} picks ${s.picks} score ${s.score}`);

    s = await waitFor(st => st.round === 2 && st.sub === 'pick', 40000);
    await tapPad(1, 2 - s.answer);
    s = await waitFor(st => st.sub === 'reveal', 12000);
    ok('P2\'s buttons read the table from their end', s.score[1] === 1 && s.picks[1] === s.answer, `answer ${s.answer} picks ${s.picks}`);
    ok('no pick before the clock runs out is a miss', s.picks[0] === -1 && s.score[0] === 1, `picks ${s.picks}`);

    s = await waitFor(st => st.round === 3 && st.sub === 'pick', 40000);
    ok('later rounds shuffle longer and faster', s.swaps > r1.swaps && s.dur < r1.dur, `round 1 ${r1.swaps}×${r1.dur}s → round 3 ${s.swaps}×${s.dur}s`);
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
