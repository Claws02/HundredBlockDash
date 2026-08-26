// ============================================================
// EVERY PARALLEL GAME ACTUALLY FILLS THE SCREEN
//
// A solo game is the 1v1 game with its playfield stretched from half the screen
// to all of it. That substitution is per-game and easy to get inside out: Tree
// Climb's `halfTop` is the TOP EDGE of a player's half, not its height, and
// setting it as though it were a height gave the half zero height and drew the
// entire tree below the bottom of the screen. Nothing threw. No assertion
// noticed. It took a screenshot.
//
// So this is that screenshot as a test. It runs each parallel game alone and
// reads the canvas back: there has to be something drawn in the top half AND
// something in the bottom half, and it has to move between two samples. That is
// the cheapest statement of "the game is on the screen and running" that does
// not care what the game looks like.
//
// usage: node soloframe.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

const pass = [], fail = [], notes = [];
const ok = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

// How much of each band of the canvas has been drawn on, and a cheap signature
// of the whole frame so two samples can be compared for movement.
const frame = page => page.evaluate(() => {
    const c = document.querySelector('#minigame-layer canvas');
    if (!c) return null;
    const g = c.getContext('2d');
    if (!g) return null;
    const W = c.width, H = c.height;
    if (!W || !H) return null;
    const band = (y0, y1) => {
        const d = g.getImageData(0, y0, W, y1 - y0).data;
        // "Drawn on" means visibly different from the darkest thing in frame.
        //
        // WEIGHTED BY ALPHA, and that is the whole point. getImageData returns
        // colour UN-premultiplied, so a pixel painted with rgba(255,90,90,0.05)
        // — Loot Catch's faint field tint — comes back as (255, 90, 90) with an
        // alpha of 13. Summing the channels alone called that fully lit, and
        // reported 100% of Loot Catch's screen as drawn on. A probe that counts
        // a 5% wash as content would have passed Tree Climb drawing nothing at
        // all, which is the exact failure this exists to catch.
        let lit = 0, n = 0, sum = 0;
        for (let i = 0; i < d.length; i += 4 * 41) {   // stride: a sample, not a survey
            const a = d[i + 3] / 255;
            const v = (d[i] + d[i + 1] + d[i + 2]) * a;
            n++; sum += v;
            if (v > 120) lit++;
        }
        return { frac: n ? lit / n : 0, sum: Math.round(sum) };
    };
    return { top: band(0, Math.floor(H / 2)), bottom: band(Math.floor(H / 2), H) };
});

(async () => {
    const errors = [];
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`PAGEERROR ${e.message}`));
    page.on('console', m => {
        const t = m.text();
        if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(t);
        if (m.type() === 'warning' && /\[solo\]/.test(t)) errors.push('WARN ' + t);
    });

    try {
        await page.addInitScript(() => {
            try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {}
        });
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: AGENT });
        await page.waitForFunction(() => !!window.__QA, null, { timeout: 20000 });
        await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
        await page.evaluate(() => window.__QA.bind());

        const games = await page.evaluate(async () =>
            (await import('/src/config/MinigameRegistry.js')).MG_PARALLEL);
        ok('the registry names some games that can be played across phones',
            Array.isArray(games) && games.length > 0, JSON.stringify(games));
        notes.push(`parallel games: ${(games || []).join(', ')}`);

        for (const g of games || []) {
            await page.evaluate(async game => {
                const A = await import('/src/minigames/SoloArena.js');
                window.__soloDone = false;
                A.play(game, 4242, () => { window.__soloDone = true; }, 60000);
            }, g);
            // Two rAFs plus a beat: every game waits for layout before its first frame.
            await page.waitForTimeout(2200);
            const a = await frame(page);
            // Nudge it, in case a game only redraws on input.
            await page.mouse.move(206, 500);
            await page.mouse.down();
            await page.mouse.move(150, 620);
            await page.waitForTimeout(1400);
            const b = await frame(page);

            if (!a || !b) {
                ok(`${g} puts a canvas on the screen`, false, 'no canvas, or a zero-sized one');
            } else {
                notes.push(`${g}: top ${(a.top.frac * 100).toFixed(1)}% lit, bottom ${(a.bottom.frac * 100).toFixed(1)}%`);
                // THE ONE THAT CAUGHT TREE CLIMB. A playfield drawn below the
                // bottom of the screen leaves one band completely empty.
                ok(`${g} draws in the top half of the screen`, a.top.frac > 0.001,
                    `${(a.top.frac * 100).toFixed(2)}% of sampled pixels lit`);
                ok(`${g} draws in the bottom half of the screen`, a.bottom.frac > 0.001,
                    `${(a.bottom.frac * 100).toFixed(2)}% of sampled pixels lit`);
                // The detail is shown on pass as well as fail, so it states
                // what was measured rather than what would have been wrong.
                ok(`${g} is running, not a still frame`,
                    a.top.sum !== b.top.sum || a.bottom.sum !== b.bottom.sum,
                    `two samples 1.4s apart: ${a.top.sum}/${a.bottom.sum} then ${b.top.sum}/${b.bottom.sum}`);
            }
            await page.mouse.up().catch(() => {});
            await page.evaluate(async () => {
                const A = await import('/src/minigames/SoloArena.js');
                A.forceEnd(0);
            });
            await page.waitForTimeout(500);
        }

        ok('no parallel game produces errors', errors.length === 0, errors.slice(0, 5).join(' | '));
    } catch (e) {
        fail.push('HARNESS: ' + (e && e.message));
    }

    await browser.close();
    console.log('\n=== EVERY PARALLEL GAME, ON A WHOLE SCREEN ===');
    notes.forEach(n => console.log('  ·     ' + n));
    pass.forEach(p => console.log('  PASS  ' + p));
    fail.forEach(f => console.log('  FAIL  ' + f));
    if (errors.length) { console.log('\n  ERRORS'); errors.slice(0, 8).forEach(e => console.log('    ' + e)); }
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exit(fail.length ? 1 : 0);
})();
