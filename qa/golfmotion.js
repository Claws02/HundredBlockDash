// Mini golf: the travel animations — a ball fired into the cannon, the hose,
// the loop and a teleporter — filmed a frame every 0.3 s.
// usage: node golfmotion.js [outdir]
const path = require('path');
const OUT = process.argv[2] || __dirname;
const SHOTS = [
    { key: 'cannon', at: [7, 0], p: 0.35 },
    { key: 'hose', at: [9.4, -0.6], p: 0.35 },
    { key: 'donut', at: [6.5, 0], p: 0.75 },
    { key: 'hub', at: [4.3, -1.8], p: 0.35 },
];
require('./stageprobe').run('minigolf', async ({ page, ok, launch, state }) => {
    for (const sh of SHOTS) {
        await page.evaluate(async k => { const M = await import('/src/claw-core/minigames/MiniGolf.js'); M._debugForceHoles([k]); M.configure({ mode: 'turns', round: true }); }, sh.key);
        await launch();
        const t0 = Date.now();
        let s;
        while (Date.now() - t0 < 20000) { s = await state(); if (s && s.sub === 'fly') break; await page.waitForTimeout(100); }
        await page.evaluate(() => window.__G._debugSkip());
        await page.waitForTimeout(400);
        await page.evaluate(() => window.__G._debugTakePass());
        await page.evaluate(([x, z]) => window.__G._debugBall(0, x, z), sh.at);
        await page.waitForTimeout(500);
        await page.evaluate(p => window.__G._debugShoot(0, 1, 0, p), sh.p);
        const track = [];
        for (let i = 0; i < 12; i++) {
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(OUT, `motion-${sh.key}-${String(i).padStart(2, '0')}.png`) });
            const b = (await state()).balls[0];
            track.push(`${b.x},${b.z},${b.y}${b.air ? '^' : ''}`);
        }
        const end = (await state()).balls[0];
        ok(`${sh.key}: the ball came out the far end`, Math.hypot(end.x - sh.at[0], end.z - sh.at[1]) > 6 || end.holed, track.join(' '));
        await page.evaluate(async () => { const MM = await import('/src/claw-core/minigames/MinigameManager.js'); MM.forceEndMinigame(); });
        await page.waitForTimeout(300);
    }
    await page.evaluate(async () => { const M = await import('/src/claw-core/minigames/MiniGolf.js'); M._debugForceHoles(null); });
});
