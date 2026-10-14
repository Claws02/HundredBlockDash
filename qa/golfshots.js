// Mini golf: every hole built, shot from the tee, flyover and overview.
// usage: node golfshots.js [outdir]
const path = require('path');
const OUT = process.argv[2] || __dirname;
require('./stageprobe').run('minigolf', async ({ page, ok, launch, state }) => {
    const pool = await page.evaluate(async () => { const M = await import('/src/claw-core/minigames/MiniGolf.js'); return M._debugPool(); });
    await page.evaluate(async k => { const M = await import('/src/claw-core/minigames/MiniGolf.js'); M._debugForceHoles(k); }, pool);
    await launch({ bot: true, p1bot: true, skill: 0.6 });
    const t0 = Date.now();
    let last = -1, tries = 0;
    while (Date.now() - t0 < 240000) {
        const s = await state();
        if (!s) break;
        if (s.sub === 'fly' && s.hole !== last) {
            last = s.hole;
            await page.waitForTimeout(900);
            await page.screenshot({ path: path.join(OUT, `golf-${s.hole + 1}-fly.png`) });
            await page.evaluate(() => window.__G._debugSkip());
            await page.waitForTimeout(1500);
            await page.screenshot({ path: path.join(OUT, `golf-${s.hole + 1}-tee.png`) });
        }
        if (s.phase === 'over') break;
        await page.waitForTimeout(150);
    }
    const s = await state();
    ok('played every hole with bots', s.phase === 'over' || s.hole >= pool.length - 1, `hole ${s.hole} ${s.phase} strokes ${JSON.stringify(s.strokes)}`);
    console.log(JSON.stringify(s.strokes));
});
