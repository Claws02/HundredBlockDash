// ============================================================
// SMOKE — the CI gate. Boots the game, starts a City Circuit match against a
// bot and waits for the first roll, failing on any page error. Short enough to
// run on every push; the long probes in this folder are for release sweeps.
//
// usage: QA_BASE=http://127.0.0.1:8129/index.html node qa/ci-smoke.js
// ============================================================
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

(async () => {
    const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
    const browser = await chromium.launch({
        ...(exe ? { executablePath: exe } : {}),
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const fontReqs = [];
    page.on('request', r => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) fontReqs.push(r.url()); });
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} });

    const fail = [];
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 60000 });
    const splash = await page.evaluate(() => { const s = document.getElementById('splash'); return !!s && getComputedStyle(s).display !== 'none'; });
    if (!splash) fail.push('splash not shown');
    const fonts = await page.evaluate(async () => { await document.fonts.ready; return [document.fonts.check('16px Nunito'), document.fonts.check('16px "Bebas Neue"')]; });
    if (!fonts.every(Boolean)) fail.push('bundled fonts did not load: ' + fonts);
    if (fontReqs.length) fail.push('game still calls Google Fonts: ' + fontReqs[0]);

    await page.addScriptTag({ content: AGENT });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));
    const t0 = Date.now();
    let reached = false;
    while (Date.now() - t0 < 480000) {
        const st = await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            for (const id of ['btn-msg-continue', 'btn-cb-start']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            return window.__QA.snapshot().gameState;
        }).catch(() => '');
        if (st === 'PRE_ROLL') { reached = true; break; }
        await page.waitForTimeout(700);
    }
    if (!reached) fail.push('never reached the first roll');
    if (errors.length) fail.push('page errors: ' + errors.slice(0, 3).join(' | '));

    await browser.close();
    if (fail.length) { console.log('SMOKE FAIL\n  ' + fail.join('\n  ')); process.exit(1); }
    console.log(`SMOKE PASS — boot, bundled fonts, match to first roll in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})();
