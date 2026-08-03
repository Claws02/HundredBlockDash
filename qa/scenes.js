// ============================================================
// Scene-timing probe.
//
// Samples the live game at 40 Hz and records how long each visible "beat"
// actually lasts — the dice roll, the hop, the space result, the minigame
// hand-off, the turn pass. Produces the dwell-time table used to tune
// src/config/SceneTiming.js.
//
// A beat is the combination of (gameState, which overlay is on screen), so
// "ACKNOWLEDGE with the result modal up" is distinct from "ACKNOWLEDGE with
// nothing up" — the second is dead air the player stares at.
//
// usage: node scenes.js [map] [seconds]
//        node scenes.js hundred_block_dash 300
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const MAP = process.argv[2] || 'hundred_block_dash';
const SECONDS = parseInt(process.argv[3] || '260', 10);

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

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // Install the in-page sampler before the game starts so nothing is missed.
    await page.evaluate(() => {
        window.__SCENES = { log: [], cur: null, t0: performance.now() };
        const vis = id => {
            const el = document.getElementById(id);
            if (!el) return false;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            if (el.classList && id === 'modal-overlay') return el.classList.contains('act');
            return el.getBoundingClientRect().width > 0;
        };
        const overlayNow = () => {
            // Ordered most-specific first; the first hit names the beat.
            const ids = ['win-screen', 'gate-overlay', 'mg-intro-overlay', 'minigame-layer',
                         'branch-choice-overlay', 'map-ui', 'hbd-story-overlay', 'realm-banner',
                         'msg-modal', 'shop-modal', 'shop-offer-modal', 'duel-modal', 'drop-modal',
                         'use-modal', 'pass-modal', 'custom-dice-modal', 'ally-encounter-modal',
                         'ally-steal-modal'];
            for (const id of ids) if (vis(id)) return id;
            return 'board';
        };
        const sicVisible = () => vis('space-info-card');
        window.__SCENES.sample = () => {
            const S = window.__QA.snapshot();
            const key = `${S.gameState}|${overlayNow()}`;
            const now = performance.now();
            const L = window.__SCENES;
            if (L.cur && L.cur.key === key) { L.cur.end = now; return; }
            if (L.cur) L.log.push(L.cur);
            L.cur = { key, gameState: S.gameState, overlay: overlayNow(),
                      start: now, end: now, sic: sicVisible(), turn: S.totalTurns };
        };
        window.__SCENES.iv = setInterval(window.__SCENES.sample, 25);
    });

    const cfg = MAP === 'city_circuit'
        ? { mode: '1p', difficulty: 'medium', map: 'city_circuit' }
        : { mode: '1p', difficulty: 'medium', map: 'hundred_block_dash', len: 50 };
    await page.evaluate(c => window.__QA.startRun(c), cfg);

    // Play it like a human who reads: the agent taps as soon as something is tappable.
    const t0 = Date.now();
    await page.evaluate(() => window.__QA.setMinigameFastResolve(6000));
    while ((Date.now() - t0) / 1000 < SECONDS) {
        const r = await page.evaluate(() => window.__QA.step());
        if (r === 'WIN_SCREEN') break;
        await page.waitForTimeout(90);
    }

    const data = await page.evaluate(() => {
        clearInterval(window.__SCENES.iv);
        const L = window.__SCENES;
        if (L.cur) L.log.push(L.cur);
        return L.log.map(e => ({ key: e.key, gameState: e.gameState, overlay: e.overlay,
                                 ms: Math.round(e.end - e.start), sic: e.sic, turn: e.turn }));
    });

    // Aggregate
    const byKey = {};
    for (const e of data) {
        if (e.ms < 30) continue;              // sampling noise
        (byKey[e.key] ||= []).push(e.ms);
    }
    const rows = Object.entries(byKey).map(([key, arr]) => {
        arr.sort((a, b) => a - b);
        const sum = arr.reduce((s, v) => s + v, 0);
        return { key, n: arr.length, min: arr[0], median: arr[Math.floor(arr.length / 2)],
                 max: arr[arr.length - 1], mean: Math.round(sum / arr.length), total: sum };
    }).sort((a, b) => b.total - a.total);

    const out = { map: MAP, seconds: SECONDS, beats: data.length, rows, errors: [...new Set(errors)] };
    fs.writeFileSync(path.join(__dirname, `result-scenes-${MAP}.json`), JSON.stringify(out, null, 2));

    console.log(`\nmap=${MAP}   sampled ${data.length} beats over ${SECONDS}s\n`);
    console.log('beat (gameState | overlay)'.padEnd(42) + '  n   min  med  mean  max');
    console.log('-'.repeat(76));
    rows.forEach(r => console.log(
        r.key.padEnd(42) + String(r.n).padStart(3) +
        String(r.min).padStart(6) + String(r.median).padStart(5) +
        String(r.mean).padStart(6) + String(r.max).padStart(6)));

    // The specific thing being asked about: how long is a landing result readable?
    const land = rows.find(r => r.key === 'ACKNOWLEDGE|msg-modal');
    const dead = rows.filter(r => r.overlay === 'board' && r.gameState !== 'PRE_ROLL');
    console.log('\nresult-modal dwell (ACKNOWLEDGE|msg-modal):',
        land ? `${land.min}–${land.max} ms, median ${land.median}` : 'not observed');
    console.log('dead-air beats (board visible, not the player\'s cue):');
    dead.forEach(d => console.log(`   ${d.key.padEnd(38)} median ${d.median}ms  max ${d.max}ms  n=${d.n}`));
    if (out.errors.length) console.log('\nerrors:', out.errors.slice(0, 4));
    await browser.close();
})();
