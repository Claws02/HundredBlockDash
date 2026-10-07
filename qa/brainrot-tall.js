// ============================================================
// BRAINROT TOWER — tall-tower soak. The match has no clock, so towers get
// tall: 22 critters dropped dead centre must stand without collapsing on
// their own (deep critters lock in place; only the top four can move), and
// still be standing 5 s later. ~4 min under a software GPU.
// usage: node qa/brainrot-tall.js     (N=30 for a taller one)
// ============================================================
require('./stageprobe').run('brainrot', async ({ page, launch, state, waitPhase, forceEnd, shot, ok }) => {
    const G = (fn, ...a) => page.evaluate(([fn, a]) => window.__G[fn](...a), [fn, a]);
    await launch(); await waitPhase('play');
    await G('_debugFreeze', true);
    let s;
    const N = +(process.env.N || 22);
    for (let i = 0; i < N; i++) {
        const turn = (await state()).turn;
        await G('_debugHold', ['brick', 'brick', 'pizza', 'barrel', 'brick'][i % 5]);
        await G('_debugDropAt', 0);
        const t0 = Date.now();
        while (Date.now() - t0 < 30000) { s = await state(); if (s.toppler >= 0 || (s.turn !== turn && !s.settling && s.held)) break; await page.waitForTimeout(150); }
        if (s.toppler >= 0) break;
    }
    console.log('drops', s.drops, 'top', s.top, 'toppler', s.toppler); console.log(JSON.stringify(s.pieces.map(p => [p.key, p.x, p.y, p.off])));
    await shot('tall');
    ok(`${N} critters stack without collapsing on their own`, s.toppler < 0 && s.drops === N && s.top > 7, `top ${s.top}, drops ${s.drops}`);
    await page.waitForTimeout(5000);
    s = await state();
    ok('and still standing 5 s later', s.toppler < 0, `toppler ${s.toppler}`);
    await forceEnd();
});
