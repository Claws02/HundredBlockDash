// ============================================================
// MUSICAL CHAIRS — the fountain park, face-off hold.
//   1. Built, not turned; five walkers, four chairs.
//   2. The music plays through the minigame (forced, not gated).
//   3. Running while it plays is a false start: P1 freezes.
//   4. The stop cuts the music dead; the park-goers sit.
//   5. A real drag takes P1 to a free chair, and P1 sits.
//   6. The one left standing is out and a chair goes.
//   7. A hard bot beats an idle player; nothing leaks; no errors.
// usage: node musicalchairs.js          (screenshots: qa/shot-musicalchairs-*.png)
// ============================================================
require('./stageprobe').run('musicalchairs', async ({ page, ok, launch, state, shot, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 30000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(60); }
        return state();
    };
    const music = () => page.evaluate(async () => (await import('/src/engine/AudioManager.js')).musicState());
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('the park is built, face-off hold not turned; 5 walkers, 4 chairs', s.gl && !s.turned && s.walkers.length === 5 && s.chairs === 4, `${s.walkers.length}/${s.chairs}`);

    s = await waitFor(st => st.sub === 'walk');
    await page.waitForTimeout(600);
    const m = await music();
    ok('the band plays through the minigame', m.forced && m.mood === 'chairs' && m.cut > 0.9, JSON.stringify(m));
    await shot('walk');

    // False start: drag hard on the bottom half while the music plays.
    await page.mouse.move(206, 700); await page.mouse.down();
    await page.mouse.move(206, 610, { steps: 3 });
    s = await state();
    await page.mouse.up();
    ok('running while the music plays freezes P1', s.walkers[0].frozen > 0, `frozen ${s.walkers[0].frozen}`);
    await waitFor(st => st.walkers[0].frozen === 0, 5000);

    // The stop: P1 stood outside a free chair, then a real drag to it.
    await page.evaluate(() => { window.__G._debugNear(0, 0); window.__G._debugStop(); });
    await page.waitForTimeout(250);
    const m2 = await music();
    ok('the stop cuts the music dead', m2.cut < 0.1, JSON.stringify(m2));
    s = await state();
    const p1 = s.walkers[0];
    const len = Math.hypot(p1.x, p1.z) || 1;
    // Toward the middle is toward the chair P1 is standing outside of.
    const vx = -p1.x / len, vz = -p1.z / len;
    await page.mouse.move(206, 700); await page.mouse.down();
    await page.mouse.move(206 + vx * 60, 700 + vz * 60, { steps: 3 });
    s = await waitFor(st => st.walkers[0].seated >= 0, 6000);
    await page.mouse.up();
    ok('a real drag takes P1 to a free chair, and P1 sits', s.walkers[0].seated >= 0, JSON.stringify(s.walkers[0]));
    await shot('scramble');
    s = await waitFor(st => st.sub === 'result' || st.phase === 'over', 12000);
    await page.waitForTimeout(300);
    await shot('result');
    const outs = s.walkers.filter(w => w.out).length;
    ok('the one left standing is out', outs === 1, `out ${outs}`);
    s = await waitFor(st => st.sub === 'walk' || st.phase === 'over', 8000);
    ok('a chair goes (or the match ends on a player out)', s.phase === 'over' || s.chairs === 3, `chairs ${s.chairs} phase ${s.phase}`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(150000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    const m3 = await music();
    ok('the music goes back to the board afterwards', !m3.forced, JSON.stringify(m3));
    await cleanup();
});
