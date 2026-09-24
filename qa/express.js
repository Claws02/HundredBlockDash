// ============================================================
// THE 4:15 TO PERDITION — roof sumo on the shared stage.
//
//   1. The set, the train and both figures, turned sideways in portrait.
//   2. A real drag on the right half walks P1 along the roof.
//   3. A real tap shoves: the figure in reach is knocked back along the roof.
//   4. A real hold ducks.
//   5. A bridge sweeps off whoever is standing and passes over whoever ducks.
//   6. A bot beats an idle player; the match resolves once, inside the budget.
//   7. Nothing leaks; no page errors.
//
// Screenshots land in qa/shot-express-*.png.
//
// usage: node express.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function launch(page, { bot = false, skill = 0.55 } = {}) {
    await page.evaluate(async ({ bot, skill }) => {
        const { state } = await import('/src/core/GameState.js');
        const MM = await import('/src/minigames/MinigameManager.js');
        window.__RESULT = undefined;
        state.mgActive = true;
        state.mgType = 'express';
        state.players[0].isBot = false;
        state.players[1].isBot = bot;
        document.getElementById('minigame-layer').style.display = 'flex';
        document.getElementById('splash').style.display = 'none';
        const mod = await MM.loadMinigame('express');
        window.__EX = mod;
        window.__T0 = performance.now();
        mod.start(bot, w => { window.__RESULT = { winner: w, ms: performance.now() - window.__T0 }; }, skill);
    }, { bot, skill });
}
const dbg = page => page.evaluate(() => window.__EX && window.__EX._debugState());
const result = page => page.evaluate(() => window.__RESULT || null);
const shot = (page, name) => page.screenshot({ path: path.join(__dirname, `shot-express-${name}.png`) });

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

    // The stage turns 90° clockwise in portrait: its right half is the bottom
    // of the glass, and stage +x ("right", toward the back of the train) is
    // DOWN the glass.
    const P1 = { x: 206, y: 680 };

    // ══════ 1. Two humans ══════
    await launch(page);
    await page.waitForTimeout(900);
    await shot(page, 'intro');
    let s = await dbg(page);
    ok('stage built and turned sideways', s && s.gl && s.turned, JSON.stringify({ gl: s.gl, turned: s.turned }));
    await page.waitForFunction(() => window.__EX._debugState().phase === 'play', null, { timeout: 20000 });

    // ══════ 2. Drag to walk ══════
    const x0 = (await dbg(page)).x[0];
    await page.mouse.move(P1.x, P1.y);
    await page.mouse.down();
    await page.mouse.move(P1.x, P1.y + 40, { steps: 4 });     // stage +x: toward the rear
    await page.waitForTimeout(250);
    await page.mouse.up();
    s = await dbg(page);
    ok('a drag on the right half walks P1 along the roof', s.x[0] > x0 + 0.5 && !s.out[0], `${x0} → ${s.x[0]}`);
    await shot(page, 'walk');

    // ══════ 3. Tap to shove ══════
    await page.evaluate(() => { window.__EX._debugPlace(0, 0.6); window.__EX._debugPlace(1, -0.45); });
    await page.waitForTimeout(150);
    const before = (await dbg(page)).x[1];
    await page.mouse.move(P1.x, P1.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(250);
    await shot(page, 'shove');
    await page.waitForTimeout(350);
    s = await dbg(page);
    ok('a tap shoves the figure in reach back along the roof', s.x[1] < before - 1.0, `${before} → ${s.x[1]}`);

    // ══════ 4-5. Hold to duck, and the bridge ══════
    await page.evaluate(() => { window.__EX._debugPlace(0, 2.2); window.__EX._debugPlace(1, -2.2); });
    await page.mouse.move(P1.x, P1.y);
    await page.mouse.down();
    await page.waitForTimeout(400);
    s = await dbg(page);
    ok('a hold ducks', s.duck[0] === true && s.duck[1] === false, JSON.stringify(s.duck));
    await page.evaluate(() => window.__EX._debugBridge());
    await page.waitForTimeout(1300);
    await shot(page, 'bridge');
    await page.waitForFunction(() => { const d = window.__EX._debugState(); return d.bridge === null || d.phase !== 'play'; }, null, { timeout: 8000 });
    s = await dbg(page);
    await page.mouse.up();
    ok('the bridge sweeps off the one standing', s.out[1] === true, JSON.stringify(s.out));
    ok('...and passes over the one ducking', s.out[0] === false, JSON.stringify(s.out));
    await page.waitForTimeout(500);
    await shot(page, 'swept');
    await page.evaluate(async () => { const M = await import('/src/minigames/MinigameManager.js'); M.forceEndMinigame(); });

    // ══════ 6. A bot against an idle player ══════
    await launch(page, { bot: true, skill: 0.85 });
    let verdict = false;
    const t0 = Date.now();
    while (!(await result(page)) && Date.now() - t0 < 90000) {
        const st = await dbg(page);
        if (st && st.phase === 'over' && !verdict) { await page.waitForTimeout(1300); await shot(page, 'verdict'); verdict = true; }
        await page.waitForTimeout(200);
    }
    const r = await result(page);
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    ok('...inside the budget', !!r && r.ms / 1000 < 60, r ? `${(r.ms / 1000).toFixed(1)}s` : '—');

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
