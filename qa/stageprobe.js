// Shared scaffolding for the stage-game probes: boot, launch, state, shots.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

exports.run = async function run(key, body) {
    const pass = [], fail = [];
    const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));
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

    const t = {
        page, ok,
        launch: ({ bot = false, p1bot = false, skill = 0.55 } = {}) => page.evaluate(async ({ key, bot, p1bot, skill }) => {
            const { state } = await import('/src/core/GameState.js');
            const MM = await import('/src/minigames/MinigameManager.js');
            window.__RESULT = undefined;
            state.mgActive = true; state.mgType = key;
            state.players[0].isBot = p1bot; state.players[1].isBot = bot;
            document.getElementById('minigame-layer').style.display = 'flex';
            document.getElementById('splash').style.display = 'none';
            const mod = await MM.loadMinigame(key);
            window.__G = mod; window.__T0 = performance.now();
            mod.start(bot, w => { window.__RESULT = { winner: w, ms: performance.now() - window.__T0 }; }, skill);
        }, { key, bot, p1bot, skill }),
        state: () => page.evaluate(() => window.__G && window.__G._debugState()),
        result: () => page.evaluate(() => window.__RESULT || null),
        shot: name => page.screenshot({ path: path.join(__dirname, `shot-${key}-${name}.png`) }),
        waitPhase: (phase, ms = 20000) => page.waitForFunction(p => window.__G._debugState().phase === p, phase, { timeout: ms }),
        forceEnd: () => page.evaluate(async () => { const M = await import('/src/minigames/MinigameManager.js'); M.forceEndMinigame(); }),
        waitResult: async (ms = 90000, each) => {
            const t0 = Date.now();
            while (Date.now() - t0 < ms) {
                const r = await page.evaluate(() => window.__RESULT || null);
                if (r) return r;
                if (each) await each();
                await page.waitForTimeout(200);
            }
            return null;
        },
        cleanup: async () => {
            const after = await page.evaluate(async () => {
                const R = await import('/src/engine/Renderer.js');
                const lay = document.getElementById('minigame-layer');
                return { paused: R.isBoardPaused(), orphans: Array.from(lay.children).filter(el => !el.id).length,
                         canvases: lay.querySelectorAll('canvas').length };
            });
            ok('nothing left behind, board drawing again', !after.paused && after.orphans === 0 && after.canvases === 0, JSON.stringify(after));
        },
    };
    try { await body(t); } catch (e) { fail.push('probe threw: ' + e.message.split('\n')[0]); }
    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
};
