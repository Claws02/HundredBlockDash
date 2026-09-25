// ============================================================
// SNOWBALL FIGHT — the winter yard, face-off, overhead.
//   1. Built in the face-off hold.
//   2. A real drag moves P1 (and never over the middle line).
//   3. Standing still crouches and packs snow.
//   4. A real flick throws.
//   5. A lob that drops onto a rival hits; a wall in the way stops it.
//   6. Three hits and you're out; a hard bot beats an idle player.
// usage: node snowball.js          (screenshots: qa/shot-snowball-*.png)
// ============================================================
require('./stageprobe').run('snowball', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 6000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(40); }
        return state();
    };
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('built in the face-off hold', s.gl && !s.turned);
    await waitPhase('play', 30000);
    await G('_debugClock', 0);

    const z0 = (await state()).figs[0].z;
    await page.mouse.move(206, 760); await page.mouse.down();
    await page.mouse.move(206, 640, { steps: 4 });
    await page.waitForTimeout(3000);
    s = await state();
    await page.mouse.up();
    ok('a real drag up moves P1 forward, and never over the line', s.figs[0].z < z0 - 1 && s.figs[0].z >= 0.69, `z ${z0} → ${s.figs[0].z}`);

    await G('_debugPlace', 0, 0, 4.5, 0);
    s = await waitFor(st => st.figs[0].ammo >= 1 && st.figs[0].crouch, 4000);
    ok('standing still crouches and packs snow', s.figs[0].ammo >= 1 && s.figs[0].crouch, JSON.stringify(s.figs[0]));
    await shot('pack');

    await G('_debugPlace', 0, 0, 4.5, 2);
    // A flick is fast: send the real pointer sequence in one burst.
    await page.evaluate(() => {
        const el = document.elementFromPoint(206, 780);
        const ev = (type, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientX: 206, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
        ev('pointerdown', 780); ev('pointermove', 740); ev('pointermove', 690); ev('pointerup', 690);
    });
    s = await waitFor(st => st.figs[0].ammo === 1, 2000);
    ok('a real flick throws', s.figs[0].ammo === 1, `ammo ${s.figs[0].ammo} balls ${s.balls}`);
    await page.waitForTimeout(1200);

    await G('_debugClock', 0);
    const h0 = (await state()).figs[1].hits;      // the flick above may have landed
    await G('_debugPlace', 1, 0, -2, 0);
    await G('_debugPlace', 0, 0, 4, 3);
    await page.waitForTimeout(400);
    await G('_debugThrow', 0, 0, -1, 0.22);
    s = await waitFor(st => st.figs[1].hits === h0 + 1, 3000);
    await shot('hit');
    ok('a lob that drops onto a crouched rival hits', s.figs[1].hits === h0 + 1, `hits ${h0} → ${s.figs[1].hits}`);

    await page.waitForTimeout(700);
    await G('_debugPlace', 1, 2.3, -3.2, 0);
    await G('_debugPlace', 0, 2.3, 5, 3);
    await page.waitForTimeout(400);
    await G('_debugThrow', 0, 0, -1, 1);
    await page.waitForTimeout(1500);
    s = await state();
    ok('crouched behind a wall, a straight throw is stopped', s.figs[1].hits === h0 + 1 && s.balls === 0, `hits ${s.figs[1].hits}`);

    while ((await state()).figs[1].hits < 3) {
        const h = (await state()).figs[1].hits;
        await page.waitForTimeout(700);
        await G('_debugPlace', 1, 0, -2, 0);
        await G('_debugPlace', 0, 0, 4, 3);
        await G('_debugThrow', 0, 0, -1, 0.22);
        await waitFor(st => st.phase === 'over' || st.figs[1].hits === h + 1, 3000);
        if ((await state()).phase === 'over') break;
    }
    s = await waitFor(st => st.phase === 'over', 6000);
    ok('three hits and you\'re out', s.figs[1].out && s.winner === 0, `hits ${s.figs[1].hits} winner ${s.winner}`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false, mid = false;
    const r = await waitResult(120000, async () => {
        const st = await state();
        if (st && st.phase === 'play' && st.clock > 6 && !mid) { mid = true; await shot('play'); }
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
