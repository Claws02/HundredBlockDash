// ============================================================
// GO-KART GRAND PRIX — five circuits, split screen.
//   1. Built; two views (split screen) once the race is set.
//   2. The kart drives itself off the line.
//   3. A real drag right on P1's half steers P1 right.
//   4. Grass is slow; the shortcut path is full speed.
//   5. A hard steer at speed charges a drift; straightening fires a turbo.
//   6. A banana dropped with a real tap spins out the kart that hits it.
//   7. Crossing the line on the last lap finishes the race for that kart.
//   7b. The mushroom: a real tap fires it — well past a turbo's speed and for
//       longer, with flames, a wider camera and speed lines on your half.
//   7c. Every circuit builds, never runs two stretches of road into each
//       other, has corners a kart can take, and a bot laps it without
//       pinning itself on a wall (and takes the shortcut where there is one).
//   7d. Snowy Mountain's black ice slides the kart; Beach Boardwalk's pads boost.
//   7e. The circuit is picked at random.
//   8. A hard bot finishes 3 laps and beats an idle player; no leaks, no errors.
// usage: node kartgp.js          (screenshots: qa/shot-kartgp-*.png)
// ============================================================
require('./stageprobe').run('kartgp', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(60); }
        return state();
    };
    const K = fn => page.evaluate(async ([fn]) => (await import('/src/minigames/KartGrandPrix.js'))[fn](...(window.__KA || [])), [fn]);
    const force = key => page.evaluate(async k => (await import('/src/minigames/KartGrandPrix.js'))._debugForceTrack(k), key);
    await force('park');
    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    await waitPhase('ready', 30000);
    let s = await state();
    ok('split screen once the race is set', s.gl && s.views === 2, `views ${s.views}`);
    await waitPhase('race', 30000);
    await page.waitForTimeout(1200);
    s = await state();
    ok('the kart drives itself off the line', s.karts[0].v > 3, `v ${s.karts[0].v}`);
    await shot('race');

    // Steer right with a real drag on the bottom half.
    await page.evaluate(() => window.__G._debugPlace(0, 14, -8, 0, 10));
    const h0 = (await state()).karts[0].h;
    await page.mouse.move(206, 760); await page.mouse.down();
    await page.mouse.move(236, 760, { steps: 3 });
    await page.waitForTimeout(500);
    s = await state();
    await page.mouse.up();
    ok('a drag right steers P1 right (heading turns clockwise)', s.karts[0].h < h0 - 0.05, `h ${h0} → ${s.karts[0].h}`);

    // The infield is walled off: driving into the inner wall stops you and you
    // back off it, and you never end up inside.
    await page.evaluate(() => window.__G._debugPlace(0, 12.5, 0, -Math.PI / 2, 12));
    s = await waitFor(st => st.karts[0].rev > 0, 3000);
    const hit = s.karts[0];
    s = await waitFor(st => st.karts[0].rev === 0, 3000);
    ok('hitting a wall head-on backs you off it, and the infield stays out of bounds', hit.rev > 0 && hit.x > 9.5 && s.karts[0].x > 9.5 && s.karts[0].surf === 1,
       `hit at x ${hit.x}, after reversing x ${s.karts[0].x}`);
    await page.evaluate(() => window.__G._debugPlace(0, -8, -22, Math.PI / 2, 12));
    await page.waitForTimeout(400);
    const p = (await state()).karts[0];
    ok('the shortcut path is open and full speed', p.surf === 1 && p.x > -7.5, `surf ${p.surf} at ${p.x},${p.z}`);

    // No lap without going round: crossing the line without the checkpoints.
    await page.evaluate(() => { window.__G._debugLap(0, 0, false); window.__G._debugPlace(0, 14, -3, 0, 12); });
    await page.waitForTimeout(900);
    s = await state();
    ok('crossing the line without going round the circuit is not a lap', s.karts[0].lap === 0 && s.karts[0].z > 1, `lap ${s.karts[0].lap} z ${s.karts[0].z}`);

    // Karts bounce off each other and keep their speed.
    await page.evaluate(() => { window.__G._debugPlace(0, 12.6, -10, 0.25, 11); window.__G._debugPlace(1, 15.4, -10, -0.25, 11); });
    let gap = 0, minV = 99;
    for (let i = 0; i < 14; i++) {
        s = await state();
        gap = Math.max(gap, Math.abs(s.karts[0].x - s.karts[1].x)); minV = Math.min(minV, s.karts[0].v, s.karts[1].v);
        await page.waitForTimeout(50);
    }
    ok('karts that touch bounce apart and keep their speed', gap > 2.6 && minV > 9, `widest gap ${gap.toFixed(2)} (touching is 1.8), slowest ${minV}`);

    // Drift: a hard steer at speed, then straighten.
    // From the inside of the straight, drifting left toward the open track (the
    // inner wall is right beside you now).
    // Driven off the clock while the real drag is held, so a slow renderer
    // can't run the kart into the hairpin before the drift has charged.
    await page.evaluate(() => window.__G._debugPlace(0, 11, -14, 0, 12));
    await page.mouse.move(206, 760); await page.mouse.down();
    await page.mouse.move(146, 760, { steps: 2 });
    const charged = await page.evaluate(() => { window.__G._debugPlace(0, 11, -14, 0, 12); window.__G._debugSimDrive(0, 0.8); return window.__G._debugState().karts[0].drift; });
    await shot('drift');
    await page.mouse.up();
    const fired = await page.evaluate(() => { window.__G._debugSimDrive(0, 0.05); return window.__G._debugState().karts[0]; });
    ok('a hard steer at speed charges a drift, and straightening fires a turbo', charged >= 0.7 && fired.boost > 0 && fired.vmul < 1.5, `drift ${charged} boost ${fired.boost} ×${fired.vmul}`);

    // A banana, dropped with a real tap, spins out the rival.
    await page.evaluate(() => { window.__G._debugPlace(0, 14, 0, 0, 0.5); window.__G._debugItem(0, 'banana'); window.__G._debugPlace(1, 14, -9, 0, 9); });
    await page.mouse.click(206, 760);
    s = await waitFor(st => st.karts[1].spin > 0, 4000);
    // (P1 may drive on through an item box and pick up another banana, so the
    // spin-out is the evidence, not an empty item slot.)
    ok('a banana dropped with a tap spins out the kart that hits it', s.karts[1].spin > 0, `spin ${s.karts[1].spin}`);

    // The finish.
    await page.evaluate(() => { window.__G._debugLap(0, 2, true); window.__G._debugPlace(0, 14, -3, 0, 12); });
    s = await waitFor(st => st.winner >= 0, 5000);
    ok('crossing the line on the last lap finishes the race', s.winner === 0 && s.karts[0].done, `winner ${s.winner}`);
    s = await waitFor(st => st.phase === 'over', 8000);
    ok('then the race ends and the verdict is full-frame', s.phase === 'over' && s.views === 0, `phase ${s.phase} views ${s.views}`);
    await forceEnd();

    // The mushroom, fired with a real tap.
    await launch();
    await waitPhase('race', 30000);
    // On the long straight before the line, well clear of the hairpins.
    await page.evaluate(() => { const L = window.__G._debugState().L; window.__G._debugPlaceS(0, L - 20, 0, 10); window.__G._debugPlaceS(1, 100, 0, 0); window.__G._debugItem(0, 'shroom'); });
    await page.mouse.click(206, 760);
    const fast = await page.evaluate(() => { window.__G._debugSimDrive(0, 0.4); return window.__G._debugState().karts[0]; });
    await page.waitForTimeout(350);
    s = await state();
    await shot('shroom');
    const sk = s.karts[0];
    ok('the mushroom: well past a turbo\'s speed, for longer', fast.shroom > 1.8 && fast.vmul >= 1.8 && fast.v > 17, `shroom ${fast.shroom}s ×${fast.vmul} v ${fast.v} (top speed 13, a turbo ×1.45 for ≤1.1 s)`);
    ok('…with flames, a wider camera and speed lines on your half only', sk.flames && s.fov[0] > 70 && s.lines[0] > 0.5 && s.lines[1] === 0, `flames ${sk.flames} fov ${s.fov} lines ${s.lines}`);
    await forceEnd();

    // Every circuit: shape, and a bot lap (driven off the clock).
    const tracks = await page.evaluate(async () => (await import('/src/minigames/KartGrandPrix.js'))._debugTracks());
    ok('five circuits', tracks.length === 5, tracks.join(', '));
    for (const key of tracks) {
        await force(key);
        await launch({ bot: true, skill: 0.85 });
        await waitPhase('race', 40000);
        const g = await page.evaluate(() => window.__G._debugGeometry());
        const st = await state();
        const sim = await page.evaluate(() => { window.__G._debugPlaceS(1, 0.5, 0, 0); return window.__G._debugSimDrive(1, 40); });
        await page.evaluate(() => { const L = window.__G._debugState().L; window.__G._debugPlaceS(0, L * 0.3, 0, 12); window.__G._debugPlaceS(1, L * 0.3 + 12, 0, 12); });
        await page.waitForTimeout(1200);
        await shot(`track-${key}`);
        ok(`${key}: built; road never meets road (closest ${g.close}); corners ≥ ${g.tightest} radius; ${st.cps.length} checkpoints`,
           st.track === key && g.close >= 13 && g.tightest >= 6.5 && st.cps.length >= 3, JSON.stringify(g));
        ok(`${key}: a bot laps it in ${sim.lapAt}s with ${sim.wallHits} wall hits${st.cut ? ', through the shortcut' : ''}`,
           sim.laps >= 1 && sim.lapAt < 30 && sim.wallHits <= 2 && (!st.cut || sim.cut), JSON.stringify(sim));
        if (key === 'snow') {
            // A real drag held while the kart is driven off the clock across the ice.
            await page.mouse.move(206, 760); await page.mouse.down(); await page.mouse.move(250, 760, { steps: 2 });
            const on = await page.evaluate(() => {
                const G = window.__G, L = G._debugState().L;
                G._debugPlaceS(0, 0.22 * L, 0, 11);
                G._debugSimDrive(0, 0.45);
                return G._debugState().karts[0];
            });
            const off = await page.evaluate(() => {
                const G = window.__G, L = G._debugState().L;
                G._debugPlaceS(0, 0.05 * L, 0, 11);
                G._debugSimDrive(0, 0.45);
                return G._debugState().karts[0];
            });
            await page.mouse.up();
            ok('snow: on the black ice the kart slides — it travels wide of where it points (on tarmac it doesn\'t)', Math.abs(on.vh - on.h) > 0.08 && Math.abs(off.vh - off.h) < 0.01, `ice: nose ${on.h} travel ${on.vh} · tarmac: nose ${off.h} travel ${off.vh}`);
        }
        if (key === 'beach') {
            const pad = await page.evaluate(() => {
                const G = window.__G, st = G._debugState();
                G._debugPlaceS(0, 0.49 * st.L - 3, 0, 12);
                G._debugSimDrive(0, 0.4);
                return G._debugState().karts[0];
            });
            ok('beach: driving over a boost pad fires a boost', pad.boost > 0.5, `boost ${pad.boost}`);
        }
        await forceEnd();
    }
    // Picked at random.
    await force(null);
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
        await launch();
        await page.waitForTimeout(300);
        seen.add((await state()).track);
        await forceEnd();
    }
    ok('the circuit is picked at random', seen.size >= 2, [...seen].join(', '));
    await force('park');

    await launch({ bot: true, skill: 0.85 });
    let verdict = false, sawCut = false;
    const r = await waitResult(600000, async () => {
        const st = await state();
        if (st && st.karts && st.karts[1] && Math.abs(st.karts[1].z + 22) < 1.4 && Math.abs(st.karts[1].x) < 7) sawCut = true;
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot races 3 laps and beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    ok('the hard bot takes the shortcut', sawCut);
    await force(null);
    await cleanup();
});
