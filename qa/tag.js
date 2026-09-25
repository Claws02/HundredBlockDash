// ============================================================
// TAG, YOU'RE IT! — four maps, face-off hold.
//   1. Built, not turned; somebody is IT.
//   2. A real drag moves P1.
//   3. IT touching the runner passes it on, and the new IT is frozen.
//   4. The roundabout carries; the tunnel hides.
//   5. A real drag climbs the ladder onto the tower, runs across it and
//      takes the slide down, shooting off the bottom.
//   6. Up on a deck you can't be tagged from the ground.
//   7. The least time as IT wins — even if you're IT at the whistle.
//   8. Every map builds, and on every map a real drag gets you up its way up.
//   9. A hard bot beats an idle player; nothing leaks; no errors.
// usage: node tag.js          (screenshots: qa/shot-tag-*.png)
// ============================================================
require('./stageprobe').run('tag', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    const force = key => page.evaluate(async k => { const M = await import('/src/minigames/TagYoureIt.js'); M._debugForceMap(k); }, key);
    // A real drag on P1's half: stage dx is world x, stage dy is world z.
    const drag = async (wx, wz, ms, watch) => {
        const len = Math.hypot(wx, wz) || 1;
        await page.mouse.move(206, 760); await page.mouse.down();
        await page.mouse.move(206 + wx / len * 70, 760 + wz / len * 70, { steps: 3 });
        const t0 = Date.now(); const seen = [];
        while (Date.now() - t0 < ms) { const s = await state(); if (watch) seen.push(watch(s)); await page.waitForTimeout(40); }
        await page.mouse.up();
        return seen;
    };

    await force('playground');
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('the playground is built, face-off hold not turned; somebody is IT', s.gl && !s.turned && s.map === 'playground' && (s.it === 0 || s.it === 1));
    await waitPhase('play');

    await G('_debugIt', 1);
    await G('_debugPlace', 1, 4, -6.5);
    const f0 = (await state()).figs[0];
    await drag(-1, -1, 700);
    s = await state();
    ok('a real drag moves P1', Math.hypot(s.figs[0].x - f0.x, s.figs[0].z - f0.z) > 0.5, `${f0.x},${f0.z} → ${s.figs[0].x},${s.figs[0].z}`);

    await G('_debugPlace', 0, 0, 5);
    await G('_debugPlace', 1, 0, 5.8);
    await page.waitForTimeout(300);
    s = await state();
    ok('IT touching the runner passes it on, and the new IT is frozen', s.it === 0 && s.tags >= 1 && s.figs[0].frozen > 0, `it ${s.it} tags ${s.tags} frozen ${s.figs[0].frozen}`);

    await page.waitForTimeout(1500);
    await G('_debugPlace', 1, s.round.x + 1.0, s.round.z);
    await G('_debugPlace', 0, 4, -6.5);
    await page.waitForTimeout(700);
    const r1 = (await state()).figs[1];
    ok('the roundabout carries whoever stands on it', Math.hypot(r1.x - (s.round.x + 1.0), r1.z - s.round.z) > 0.15, `${r1.x},${r1.z}`);
    await G('_debugPlace', 1, s.hide.x, s.hide.z);
    await page.waitForTimeout(250);
    ok('the tunnel hides whoever is in it', (await state()).figs[1].hidden);

    // Up the ladder, across the tower, down the slide: one real drag toward −z.
    await G('_debugIt', 1);
    await G('_debugPlace', 1, 4.5, -7);
    const ladder = s.conns.find(c => c.kind === 'ladder');
    await G('_debugPlace', 0, ladder.foot.x, ladder.foot.z);
    const seen = await drag(0, -1, 3200, st => ({ on: st.figs[0].on, y: st.figs[0].y, sliding: st.figs[0].sliding }));
    s = await state();
    const onTower = seen.some(v => v.on === 'tower' && v.y > 1.5), slid = seen.some(v => v.sliding);
    await shot('slide');
    ok('a real drag climbs the ladder onto the tower', onTower, JSON.stringify(seen.filter((_, i) => i % 6 === 0)));
    ok('…runs across it and takes the slide down, shooting off the bottom', slid && s.figs[0].y === 0 && s.figs[0].z < 1.2, `slid ${slid} ends z ${s.figs[0].z} y ${s.figs[0].y}`);

    // Up on the tower, IT right underneath can't tag you.
    await G('_debugOnDeck', 0, 'tower');
    await G('_debugPlace', 1, -3.2, 3.4);
    await G('_debugIt', 1);
    await page.waitForTimeout(600);
    s = await state();
    ok('up on a deck you can\'t be tagged from the ground', s.it === 1, `it ${s.it} (P1 at y ${s.figs[0].y}, IT at y ${s.figs[1].y})`);

    // The score is time as IT.
    await G('_debugPlace', 0, 4, 6);
    await G('_debugPlace', 1, -4, -6);
    await G('_debugIt', 0);
    await G('_debugItTime', 8, 20);
    await G('_debugClock', 44.9);
    const r = await waitResult(20000);
    ok('the least time as IT wins — even if you\'re IT at the whistle', !!r && r.winner === 0, r ? `winner ${r.winner}` : 'no result');

    // Every map builds, and its way up works with a real drag.
    for (const key of ['playground', 'construction', 'backyard', 'snowpark']) {
        await force(key);
        await launch();
        await waitPhase('play', 30000);
        s = await state();
        await G('_debugPlace', 1, s.map === 'snowpark' ? -4 : 4.5, -7);
        await G('_debugIt', 1);
        const up = s.conns.find(c => c.kind !== 'slide');
        await G('_debugPlace', 0, up.foot.x, up.foot.z);
        const trail = await drag(up.top.x - up.foot.x, up.top.z - up.foot.z, 2600, st => ({ on: st.figs[0].on, y: st.figs[0].y }));
        await shot(`map-${key}`);
        ok(`${key}: built, and a real drag climbs its ${up.kind} onto the ${up.deck}`, s.map === key && trail.some(v => v.on === up.deck), `max y ${Math.max(...trail.map(v => v.y))}`);
        await forceEnd();
    }
    await force(null);

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r2 = await waitResult(180000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r2 && r2.winner === 1, r2 ? `winner=${r2.winner} in ${(r2.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
