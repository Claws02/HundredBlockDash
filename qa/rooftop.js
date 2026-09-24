// ============================================================
// ROOFTOP RUN — the Back Alley roofs on the shared stage, side-on hold.
//
//   1. Built, and turned sideways in portrait.
//   2. A real tap on the top of P1's half jumps; holding it jumps higher.
//   3. A real press on the bottom slides — under a sign, where standing up
//      would have stumbled.
//   4. A slide into the runner in front trips them.
//   5. Running off a roof drops to the street and climbs back up beyond it.
//   6. A hard bot beats an idle player; nothing leaks; no errors.
//
// usage: node rooftop.js          (screenshots: qa/shot-rooftop-*.png)
// ============================================================
require('./stageprobe').run('rooftop', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    // The stage turns clockwise in portrait: stage (lx, ly) sits at screen
    // (412 - ly, lx). P1 is the stage's right half — the screen's bottom half.
    const JUMP = [330, 700], SLIDE = [60, 700];
    // Watch P1 in the page, every frame, for `ms`.
    const watch = (ms, upTo = 1e9) => page.evaluate(([ms, upTo]) => new Promise(res => {
        const o = { maxY: -99, slid: false, stumbled: false, stumbled2: false, fell: false, maxX: -99 };
        const t0 = performance.now();
        const tick = () => {
            const s = window.__G._debugState();
            o.maxY = Math.max(o.maxY, s.y[0] - (o.y0 ??= s.y[0]));
            o.slid ||= s.slide[0]; if (s.x[0] <= upTo) o.stumbled ||= s.stumble[0]; o.stumbled2 ||= s.stumble[1]; o.fell ||= s.falling[0];
            o.maxX = Math.max(o.maxX, s.x[0]);
            if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(o);
        };
        tick();
    }), [ms, upTo]);
    const press = async ([x, y], ms) => { await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); };

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('rooftops built, turned sideways in portrait', s.gl && s.turned);
    await waitPhase('play');

    // Tap vs hold, from the middle of the long first roof.
    await page.evaluate(() => { window.__G._debugPlace(0, -13); window.__G._debugPlace(1, -13); });
    let w = watch(1100); await press(JUMP, 40); const tap = await w;
    await page.evaluate(() => { window.__G._debugPlace(0, -13); window.__G._debugPlace(1, -13); });
    w = watch(1100); await press(JUMP, 450); const hold = await w;
    ok('a real tap on the top of the right half jumps P1', tap.maxY > 0.6, `peak ${tap.maxY.toFixed(2)}`);
    ok('holding the jump goes higher', hold.maxY > tap.maxY + 0.3, `tap ${tap.maxY.toFixed(2)} · hold ${hold.maxY.toFixed(2)}`);

    // Under a sign: first standing up, then sliding.
    s = await state();
    const sign = s.hazards.find(h => h.kind === 'sign');
    if (sign) {
        await page.evaluate(x => { window.__G._debugPlace(0, x); window.__G._debugPlace(1, x - 6); }, sign.x - 2.2);
        const stood = await watch(700, sign.end + 0.5);
        await page.evaluate(x => { window.__G._debugPlace(0, x); window.__G._debugPlace(1, x - 6); }, sign.x - 2.4);
        w = watch(900, sign.end + 0.5);
        await page.mouse.move(...SLIDE); await page.mouse.down();
        await page.waitForTimeout(80);
        await shot('slide');
        await page.waitForTimeout(500); await page.mouse.up();
        const slid = await w;
        ok('standing up into a sign stumbles', stood.stumbled);
        ok('a real press on the bottom slides P1 under it', slid.slid && !slid.stumbled && slid.maxX > sign.end, `slid=${slid.slid} stumbled=${slid.stumbled}`);
    } else ok('the course has a sign to slide under', false);

    // The tackle: P2 just in front on the first roof.
    await page.evaluate(() => { window.__G._debugPlace(0, -13); window.__G._debugPlace(1, -12.4); });
    w = watch(700); await press(SLIDE, 200); const tk = await w;
    ok('a slide into the runner in front trips them', tk.stumbled2, `P2 stumbled=${tk.stumbled2}`);
    await shot('tackle');

    // Off the edge of a roof without jumping.
    s = await state();
    // Level or up: dropping to a much lower roof can be walked off safely.
    const gap = s.hazards.find(h => h.kind === 'gap' && h.x > 20 && h.up >= 0);
    await page.evaluate(x => window.__G._debugPlace(0, x), gap.x - 1.5);
    const drop = await watch(2600);
    s = await state();
    ok('running off a roof drops to the street and climbs back up beyond it', drop.fell && s.x[0] > gap.end && !s.falling[0],
        `fell=${drop.fell} x=${s.x[0]} past ${gap.end}`);
    await shot('run');
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const r = await waitResult(100000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
