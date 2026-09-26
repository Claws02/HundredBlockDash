// ============================================================
// ROOFTOP RUN — the Back Alley roofs on the shared stage, side-on hold.
//
//   1. Built, and turned sideways in portrait.
//   2. A real swipe UP on P1's half jumps; keeping the finger down jumps higher.
//      A plain tap does nothing.
//   3. A real swipe DOWN slides — under a sign, where standing up would have
//      stumbled.
//   3b. Every sign on every roof hangs where it is judged: its lit bar sits
//      at the height the runner meets it, however high or low the roof.
//   4. A slide into the runner in front trips them.
//   5. Running off a roof drops to the street and climbs back up beyond it.
//   6. A hard bot beats an idle player; nothing leaks; no errors.
//
// usage: node rooftop.js          (screenshots: qa/shot-rooftop-*.png)
// ============================================================
require('./stageprobe').run('rooftop', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    // The stage turns clockwise in portrait: stage (lx, ly) sits at screen
    // (412 - ly, lx). P1 is the stage's right half — the screen's bottom half.
    // Landscape "up" is the portrait screen's +x: a swipe up is a drag to the right.
    const UP = 80, DOWN = -80;
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
    const swipe = async (d, ms) => {
        await page.mouse.move(206, 700); await page.mouse.down();
        await page.mouse.move(206 + d, 700, { steps: 2 });
        await page.waitForTimeout(ms); await page.mouse.up();
    };
    const press = async ms => { await page.mouse.move(206, 700); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); };

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('rooftops built, turned sideways in portrait', s.gl && s.turned);
    await waitPhase('play');

    // Tap vs hold, from the middle of the long first roof.
    await page.evaluate(() => { window.__G._debugPlace(0, -13); window.__G._debugPlace(1, -13); });
    let w = watch(900); await press(40); const tapped = await w;
    ok('a plain tap does nothing', tapped.maxY < 0.05 && !tapped.slid, `peak ${tapped.maxY.toFixed(2)} slid ${tapped.slid}`);
    await page.evaluate(() => { window.__G._debugPlace(0, -13); window.__G._debugPlace(1, -13); });
    // A quick flick: the real pointer sequence in one burst (and caught on release).
    w = watch(1100);
    await page.evaluate(() => {
        const el = document.elementFromPoint(206, 700);
        const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, clientX: x, clientY: 700, buttons: type === 'pointerup' ? 0 : 1 }));
        ev('pointerdown', 206); ev('pointermove', 246); ev('pointermove', 286); ev('pointerup', 286);
    });
    const tap = await w;
    await page.evaluate(() => { window.__G._debugPlace(0, -13); window.__G._debugPlace(1, -13); });
    w = watch(1100); await swipe(UP, 450); const hold = await w;
    ok('a real swipe up on P1\'s half jumps', tap.maxY > 0.6 && !tap.slid, `peak ${tap.maxY.toFixed(2)}`);
    ok('keeping the finger down goes higher', hold.maxY > tap.maxY + 0.3, `flick ${tap.maxY.toFixed(2)} · hold ${hold.maxY.toFixed(2)}`);

    // Under a sign: first standing up, then sliding.
    s = await state();
    const sign = s.hazards.find(h => h.kind === 'sign');
    if (sign) {
        await page.evaluate(x => { window.__G._debugPlace(0, x); window.__G._debugPlace(1, x - 6); }, sign.x - 2.2);
        const stood = await watch(700, sign.end + 0.5);
        await page.evaluate(x => { window.__G._debugPlace(0, x); window.__G._debugPlace(1, x - 6); }, sign.x - 2.4);
        w = watch(900, sign.end + 0.5);
        await page.mouse.move(206, 700); await page.mouse.down(); await page.mouse.move(206 + DOWN, 700, { steps: 2 });
        await page.waitForTimeout(80);
        await shot('slide');
        await page.waitForTimeout(500); await page.mouse.up();
        const slid = await w;
        ok('standing up into a sign stumbles', stood.stumbled);
        ok('a real swipe down slides P1 under it', slid.slid && !slid.stumbled && slid.maxX > sign.end, `slid=${slid.slid} stumbled=${slid.stumbled}`);
    } else ok('the course has a sign to slide under', false);

    // The tackle: P2 just in front on the first roof.
    await page.evaluate(() => { window.__G._debugPlace(0, -13); window.__G._debugPlace(1, -12.4); });
    w = watch(700); await swipe(DOWN, 200); const tk = await w;
    ok('a slide into the runner in front trips them', tk.stumbled2, `P2 stumbled=${tk.stumbled2}`);
    await shot('tackle');

    // Every sign's lit bar is where it is judged, on high roofs and low.
    const bars = await page.evaluate(() => window.__G._debugSignBars());
    ok('every sign hangs where it is judged, whatever the roof height', bars.length > 0 && bars.every(b => Math.abs(b.mesh - b.judged) < 0.05),
       JSON.stringify(bars.filter(b => Math.abs(b.mesh - b.judged) >= 0.05).slice(0, 3)) + ` of ${bars.length} (roof heights ${[...new Set(bars.map(b => b.roof))].join(',')})`);
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
