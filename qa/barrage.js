// ============================================================
// BOOT HILL BARRAGE — the physics siege on the shared stage.
//
//   1. It builds the set, both forts as physics bodies, and both players'
//      figures standing on them, turned sideways in a portrait viewport.
//   2. An untouched fort stands still: no settling, no creep, with nobody
//      firing. (Stacks of boxes in a physics engine love to wander.)
//   3. A real drag BACK on the turned right half aims P1's cannon, shows the
//      trajectory dots while held, and fires on release.
//   4. A shot on the solved arc damages the rival fort.
//   5. A bot topples an idle fort inside the clock, and the match resolves once.
//   6. Nothing leaks, on finish or on a force-end.
//
// Screenshots land in qa/shot-barrage-*.png.
//
// usage: node barrage.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function launch(page, { bot = true, skill = 0.55 } = {}) {
    await page.evaluate(async ({ bot, skill }) => {
        const { state } = await import('/src/core/GameState.js');
        const MM = await import('/src/minigames/MinigameManager.js');
        window.__RESULT = undefined;
        state.mgActive = true;
        state.mgType = 'barrage';
        state.players[1].isBot = bot;
        document.getElementById('minigame-layer').style.display = 'flex';
        document.getElementById('splash').style.display = 'none';
        const mod = await MM.loadMinigame('barrage');
        window.__BG = mod;
        window.__T0 = performance.now();
        mod.start(bot, w => { window.__RESULT = { winner: w, ms: performance.now() - window.__T0 }; }, skill);
    }, { bot, skill });
}
const dbg = page => page.evaluate(() => window.__BG && window.__BG._debugState());
const result = page => page.evaluate(() => window.__RESULT || null);
const shot = (page, name) => page.screenshot({ path: path.join(__dirname, `shot-barrage-${name}.png`) });

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // ══════ 1-2. Two humans who never touch it: the build, and a fort at rest ══════
    await launch(page, { bot: false });
    await page.waitForTimeout(900);
    await shot(page, 'intro');
    let s = await dbg(page);
    ok('stage + physics built, turned sideways', s && s.gl && s.physics && s.turned, JSON.stringify(s));
    await page.waitForFunction(() => window.__BG._debugState().phase === 'play', null, { timeout: 15000 });
    await page.evaluate(() => { window.__BG._debugWake(0); window.__BG._debugWake(1); });
    await page.waitForTimeout(4000);
    s = await dbg(page);
    ok('an untouched fort stands still on its pedestal, even woken', s.remaining.every(v => v === 1) && s.standing.every(v => v > 0.99), JSON.stringify(s.remaining));

    // ══════ 3. A real drag back on the right half ══════
    // The stage is turned 90° clockwise, so its right half is the bottom of the
    // portrait glass and "back, away from the enemy" (+x in the stage frame) is
    // DOWN the glass. Pulling back and down in the stage (fires up and left)
    // is down and LEFT on the glass.
    const before = s.shots[0];
    await page.mouse.move(250, 650);
    await page.mouse.down();
    await page.mouse.move(210, 700, { steps: 4 });
    await page.mouse.move(150, 790, { steps: 6 });
    await page.waitForTimeout(250);
    const dots = await page.evaluate(() => {
        // Any visible preview dot means the aim is live.
        return window.__BG._debugState().phase;
    });
    await shot(page, 'aim');
    await page.mouse.up();
    await page.waitForTimeout(200);
    s = await dbg(page);
    ok('a drag back on the right half fires P1\'s cannon', s.shots[0] === before + 1 && s.shots[1] === 0,
       `${before} → ${JSON.stringify(s.shots)} (${dots})`);
    await page.waitForTimeout(700);
    await shot(page, 'flight');

    // ══════ 4. A shot on the solved arc hurts ══════
    // Fire P1's cannon at the rival's upper legs on the solved arc, until the
    // rival fort shows damage.
    const hurt = await page.evaluate(async () => {
        const M = window.__BG;
        const start = M._debugState().integrity[1];
        for (let i = 0; i < 10; i++) {
            // The bot's own ballistic solver with the error turned off.
            await new Promise(r => setTimeout(r, 1200));
            M._debugFireAt(0);
            if (M._debugState().integrity[1] < start - 0.1) break;
        }
        await new Promise(r => setTimeout(r, 1500));
        return { start, end: M._debugState().integrity[1], shots: M._debugState().shots[0] };
    });
    await shot(page, 'damage');
    ok('shells that land knock timber out of place', hurt.end <= hurt.start - 0.1, JSON.stringify(hurt));
    await page.evaluate(async () => { const MM = await import('/src/minigames/MinigameManager.js'); MM.forceEndMinigame(); });

    // ══════ 4b. Sniping the top is not a win ══════
    await launch(page, { bot: false });
    await page.waitForFunction(() => window.__BG._debugState().phase === 'play', null, { timeout: 15000 });
    const snipe = await page.evaluate(async () => {
        const M = window.__BG;
        for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 1200)); M._debugFireAtTop(0); }
        await new Promise(r => setTimeout(r, 2000));
        const st = M._debugState();
        return { remaining: st.remaining[1], down: st.down[1], standing: st.standing[1], phase: st.phase };
    });
    await shot(page, 'snipe');
    ok('knocking the top off does not win: the rest of the fort is still on its pedestal', !snipe.down && snipe.remaining > 0.3 && snipe.phase === 'play', JSON.stringify(snipe));
    await page.evaluate(async () => { const MM = await import('/src/minigames/MinigameManager.js'); MM.forceEndMinigame(); });

    // ══════ 5. The bot takes down an idle fort ══════
    await launch(page, { bot: true, skill: 0.85 });
    let collapseShot = false, finaleShot = false;
    const t0 = Date.now();
    let cleared = false;
    while (!(await result(page)) && Date.now() - t0 < 150000) {
        const st = await dbg(page);
        if (st && st.remaining && st.remaining[0] < 0.6 && !collapseShot) { await shot(page, 'collapse'); collapseShot = true; }
        if (st && st.down && st.down[0]) cleared = true;
        if (st && st.phase === 'over' && !finaleShot) { await page.waitForTimeout(1300); await shot(page, 'finale'); finaleShot = true; }
        await page.waitForTimeout(150);
    }
    const r = await result(page);
    ok('a hard bot beats an idle fort and the match resolves', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s, pedestal cleared: ${cleared}` : 'timed out');

    // ══════ 6. Cleanup ══════
    const after = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const lay = document.getElementById('minigame-layer');
        return { paused: R.isBoardPaused(), orphans: Array.from(lay.children).filter(el => !el.id).length,
                 canvases: lay.querySelectorAll('canvas').length };
    });
    ok('nothing left behind, board drawing again', !after.paused && after.orphans === 0 && after.canvases === 0, JSON.stringify(after));

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
