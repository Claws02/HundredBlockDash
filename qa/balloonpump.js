// ============================================================
// BALLOON PUMP — the Promenade balloon stall, side-on hold.
//   1. Built, and turned sideways in portrait.
//   2. Holding P1's half pumps P1's balloon; letting go stops it.
//   3. Pumping past the limit pops it; a popped balloon scores 0, the pop ends
//      the round at once, and the other balloon banks its size and wins it.
//   4. At the whistle an unpopped balloon scores its size.
//   5. Near the limit the balloon strains (the tell).
//   6. A hard bot beats an idle player; nothing leaks; no errors.
// usage: node balloonpump.js          (screenshots: qa/shot-balloonpump-*.png)
// ============================================================
require('./stageprobe').run('balloonpump', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 30000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(60); }
        return state();
    };
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('the stall is built, turned sideways in portrait', s.gl && s.turned);

    s = await waitFor(st => st.sub === 'pump');
    await page.evaluate(() => window.__G._debugLimit(99));
    // P1's half is the bottom of the portrait screen when turned.
    await page.mouse.move(206, 700); await page.mouse.down();
    await page.waitForTimeout(1200);
    const mid = await state();
    await shot('pumping');
    await page.mouse.up();
    await page.waitForTimeout(500);
    const a = await state();
    await page.waitForTimeout(700);
    const b = await state();
    ok('holding pumps P1', mid.pumping[0] && mid.size[0] > 3, `size ${mid.size[0]}`);
    ok('letting go stops it', !b.pumping[0] && Math.abs(b.size[0] - a.size[0]) < 0.5, `${a.size[0]} → ${b.size[0]}`);
    ok('P2 (not a bot, not touched) did not pump', b.size[1] === 0);

    // The tell, then the pop.
    await page.evaluate(() => { window.__G._debugLimit(60); window.__G._debugSize(0, 50); window.__G._debugSize(1, 30); });
    await page.waitForTimeout(250);
    await shot('strain');
    await page.mouse.move(206, 700); await page.mouse.down();
    s = await waitFor(st => st.popped[0] || st.sub !== 'pump', 8000);
    await page.mouse.up();
    ok('pumping past the limit pops it', s.popped[0], `size ${s.size[0]} limit ${s.limit}`);
    ok('the pop ends the round on the spot', s.sub === 'tally', `sub ${s.sub}`);
    ok('a popped balloon scores nothing; the other banks its size and wins the round',
       s.score[0] === 0 && s.score[1] === 30 && s.roundWin === 1, `score ${s.score} roundWin ${s.roundWin}`);
    await page.waitForTimeout(300);
    await shot('pop');
    await forceEnd();

    // Scoring an unpopped balloon.
    await launch();
    s = await waitFor(st => st.sub === 'pump');
    await page.evaluate(() => { window.__G._debugLimit(99); window.__G._debugSize(0, 40); });
    s = await waitFor(st => st.sub === 'tally', 15000);
    ok('at the whistle an unpopped balloon scores its size', s.score[0] === 40, `score ${s.score[0]}`);
    await page.waitForTimeout(400);
    await shot('tally');
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(150000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
