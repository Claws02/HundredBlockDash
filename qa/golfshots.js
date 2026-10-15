// Mini golf: every hole of a course built, shot from the tee and from above.
// usage: [KEYS=hole,hole] node golfshots.js <course|all> [outdir]
const path = require('path');
const WANT = process.argv[2] || 'all';
const OUT = process.argv[3] || __dirname;
require('./stageprobe').run('minigolf', async ({ page, ok, launch, state }) => {
    const list = await page.evaluate(async () => {
        const C = await import('/src/claw-core/minigames/golf/Courses.js');
        return C.COURSES.map(c => ({ key: c.key, holes: c.holes.map(h => h.key) }));
    });
    let built = 0, total = 0;
    for (const c of list.filter(c => WANT === 'all' || c.key === WANT)) {
        for (const [i, key] of c.holes.entries()) {
            if (process.env.KEYS && !process.env.KEYS.split(',').includes(key)) continue;   // KEYS=a,b: just those holes
            total++;
            await page.evaluate(async k => { const M = await import('/src/claw-core/minigames/MiniGolf.js'); M._debugForceHoles([k]); M.configure({ mode: 'turns', round: true }); }, key);
            await launch();
            const t0 = Date.now();
            let s;
            while (Date.now() - t0 < 20000) { s = await state(); if (s && s.sub === 'fly') break; await page.waitForTimeout(100); }
            await page.evaluate(() => window.__G._debugSkip());
            await page.waitForTimeout(400);
            await page.evaluate(() => window.__G._debugTakePass());
            await page.waitForTimeout(1400);
            await page.screenshot({ path: path.join(OUT, `golf-${c.key}-${i + 1}-tee.png`) });
            await page.evaluate(() => window.__G._debugView('map'));
            await page.waitForTimeout(1300);
            await page.screenshot({ path: path.join(OUT, `golf-${c.key}-${i + 1}-map.png`) });
            s = await state();
            if (s && s.gl && s.holes[0] === key) built++;
            await page.evaluate(async () => { const MM = await import('/src/claw-core/minigames/MinigameManager.js'); MM.forceEndMinigame(); });
            await page.waitForTimeout(300);
        }
    }
    await page.evaluate(async () => { const M = await import('/src/claw-core/minigames/MiniGolf.js'); M._debugForceHoles(null); });
    ok('every hole builds and plays', built === total, `${built}/${total}`);
});
