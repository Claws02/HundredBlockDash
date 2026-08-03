// ============================================================
// Win-screen check: landscape presentation + the turn-by-turn race chart.
//
// Drives a real match briefly so `state.history` is populated by the real
// recorder, then ends it and inspects what the player would see. Screenshots
// both orientations — this is the one surface where a picture is the evidence.
//
// usage: node winscreen.js [map]
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const MAP = process.argv[2] || 'hundred_block_dash';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    const cfg = MAP === 'city_circuit'
        ? { mode: '1p', difficulty: 'medium', map: 'city_circuit' }
        : { mode: '1p', difficulty: 'medium', map: 'hundred_block_dash', len: 50 };
    await page.evaluate(c => window.__QA.startRun(c), cfg);
    await page.waitForFunction(async () => {
        const R = await import('/src/engine/Renderer.js');
        return R.getTileMeshes().length > 0;
    }, null, { timeout: 40000 });

    // Play long enough for the real recorder to build a history worth charting.
    await page.evaluate(() => window.__QA.setMinigameFastResolve(2500));
    const t0 = Date.now();
    while ((Date.now() - t0) / 1000 < 170) {
        const r = await page.evaluate(() => window.__QA.step());
        if (r === 'WIN_SCREEN') break;
        const n = await page.evaluate(() => window.__QA.snapshot().totalTurns);
        if (n >= 10) break;
        await page.waitForTimeout(100);
    }

    const hist = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return { len: state.history.length, sample: state.history.slice(0, 3), turns: state.totalTurns };
    });
    ok('history: the recorder captured turns during real play', hist.len >= 3,
       `${hist.len} entries over ${hist.turns} turns`);
    ok('history: entries carry progress and coins for both players',
       hist.sample.every(e => Array.isArray(e.prog) && e.prog.length === 2 && Array.isArray(e.coins)),
       JSON.stringify(hist.sample[0] || {}));

    // End the match for real.
    await page.evaluate(async () => {
        const W = await import('/src/core/WinScreen.js');
        W.calculateWinner();
    });
    await page.waitForTimeout(900);

    const view = await page.evaluate(() => {
        const scr = document.getElementById('win-screen');
        const inner = document.getElementById('win-inner');
        const svg = document.querySelector('#win-chart svg');
        const cs = getComputedStyle(inner);
        return {
            visible: getComputedStyle(scr).display !== 'none',
            rotated: /matrix/.test(cs.transform) && !scr.classList.contains('portrait'),
            transform: cs.transform,
            hasSvg: !!svg,
            polylines: svg ? svg.querySelectorAll('polyline').length : 0,
            legend: (document.getElementById('win-chart-legend') || {}).innerText || '',
            innerW: inner.clientWidth, innerH: inner.clientHeight,
            viewW: window.innerWidth, viewH: window.innerHeight,
            cardsText: (document.getElementById('win-cards') || {}).innerText.slice(0, 60),
        };
    });
    ok('win screen: shows', view.visible);
    ok('win screen: laid out along the long axis (landscape)',
       view.innerW > view.innerH && view.innerW >= view.viewH - 4,
       `inner ${view.innerW}x${view.innerH} in viewport ${view.viewW}x${view.viewH}`);
    ok('win screen: is rotated for the flat-on-the-table read', view.rotated, view.transform);
    ok('chart: renders an SVG', view.hasSvg);
    ok('chart: one line per player', view.polylines === 2, `${view.polylines} polylines`);
    ok('chart: legend names both players and the turn count',
       /turns:/.test(view.legend), view.legend.replace(/\n/g, ' | '));
    await page.screenshot({ path: path.join(__dirname, `shot-win-landscape-${MAP}.png`) });

    // Portrait toggle
    await page.evaluate(() => document.getElementById('btn-win-rotate').click());
    await page.waitForTimeout(500);
    const portrait = await page.evaluate(() => {
        const inner = document.getElementById('win-inner');
        return { w: inner.clientWidth, h: inner.clientHeight,
                 cls: document.getElementById('win-screen').className };
    });
    ok('win screen: rotate toggle returns to portrait', portrait.h > portrait.w,
       `${portrait.w}x${portrait.h} class="${portrait.cls}"`);
    await page.screenshot({ path: path.join(__dirname, `shot-win-portrait-${MAP}.png`) });

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(__dirname, `result-winscreen-${MAP}.json`),
        JSON.stringify({ pass, fail, hist, view, portrait, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
