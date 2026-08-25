// ============================================================
// Playwright QA driver — boots Hundred Block Dash, plays it, reports.
// usage: node run.js <configName> [maxSeconds]
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

const CONFIGS = {
    hbd50_1p:    { mode: '1p', difficulty: 'medium', map: 'hundred_block_dash', len: 50 },
    hbd75_1p:    { mode: '1p', difficulty: 'hard',   map: 'hundred_block_dash', len: 75 },
    hbd100_1p:   { mode: '1p', difficulty: 'easy',   map: 'hundred_block_dash', len: 100 },
    hbd50_pass:  { mode: 'pass', map: 'hundred_block_dash', len: 50 },
    hbd50_table: { mode: 'tabletop', map: 'hundred_block_dash', len: 50 },
    city_1p:     { mode: '1p', difficulty: 'medium', map: 'city_circuit' },
    city_pass:   { mode: 'pass', map: 'city_circuit' },
    city_hard:   { mode: '1p', difficulty: 'hard', map: 'city_circuit' },
    // Three- and four-seat hot-seat matches. These are the Phase A gate: the
    // board has to reach a win screen with more than two players before any of
    // the networking work is worth starting.
    city_3p:     { mode: 'pass', map: 'city_circuit', players: 3, rounds: 6 },
    city_4p:     { mode: 'pass', map: 'city_circuit', players: 4, rounds: 6 },
    hbd50_4p:    { mode: 'pass', map: 'hundred_block_dash', len: 50, players: 4 },
};

(async () => {
    const cfgName = process.argv[2] || 'hbd50_1p';
    const maxSec = parseInt(process.argv[3] || '600', 10);
    const cfg = CONFIGS[cfgName];
    if (!cfg) { console.error('unknown config', cfgName); process.exit(2); }

    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();

    const consoleErrors = [], pageErrors = [], warnings = [], failedReqs = [];
    page.on('console', m => {
        const t = m.type(), txt = m.text();
        if (t === 'error') consoleErrors.push(txt);
        else if (t === 'warning') warnings.push(txt);
    });
    page.on('pageerror', e => pageErrors.push(e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
    page.on('requestfailed', r => failedReqs.push(r.url() + ' :: ' + (r.failure() || {}).errorText));

    const out = { config: cfgName, cfg, steps: [], outcome: null, stuck: null };

    // Seed storage before any page script runs: skip first-run onboarding, no rematch intent.
    await page.addInitScript(() => {
        try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {}
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 15000 });
    // Wait for the module graph to boot (main.js appends the module script).
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(c => window.__QA.startRun(c), cfg);

    const t0 = Date.now();
    let lastSig = '', sameFor = 0, lastResult = '';
    const stateCounts = {};
    let winSeen = false;

    while ((Date.now() - t0) / 1000 < maxSec) {
        const res = await page.evaluate(() => {
            try { return { r: window.__QA.step(), s: window.__QA.snapshot() }; }
            catch (e) { return { r: 'AGENT_ERROR: ' + e.message, s: {} }; }
        });
        lastResult = res.r;
        stateCounts[String(res.r).split(':')[0]] = (stateCounts[String(res.r).split(':')[0]] || 0) + 1;

        if (res.r === 'WIN_SCREEN') { winSeen = true; out.outcome = 'WIN_SCREEN'; break; }
        if (res.r === 'BOOT_ERROR') { out.outcome = 'BOOT_ERROR'; break; }
        if (String(res.r).startsWith('AGENT_ERROR')) { out.outcome = res.r; break; }

        const sig = JSON.stringify(res.s);
        if (sig === lastSig) sameFor++; else { sameFor = 0; lastSig = sig; }
        // ~45 s of no state change at all == soft lock.
        //
        // Except while a minigame is running, where nothing in the snapshot is
        // SUPPOSED to change until it ends: coins, positions and turn all sit
        // still for the whole game. A Bomb Pass rally that goes the distance is
        // 56 s and a Memory Match can run to 240 s, so this window flagged
        // healthy games as locked. Inside a minigame the manager's own watchdog
        // is the guarantee, and the run's overall budget still bounds it.
        if (sameFor > 300 && !res.s.mgActive) {
            out.stuck = { lastResult: res.r, snapshot: res.s, visible: await visibleOverlays(page) };
            out.outcome = 'SOFT_LOCK';
            break;
        }
        await page.waitForTimeout(150);
    }
    if (!out.outcome) out.outcome = 'TIMEOUT_' + maxSec + 's';

    const rep = await page.evaluate(() => window.__QA.report());
    out.report = rep;
    out.stateCounts = stateCounts;
    out.lastResult = lastResult;
    out.consoleErrors = [...new Set(consoleErrors)].slice(0, 40);
    out.pageErrors = [...new Set(pageErrors)].slice(0, 40);
    out.warnings = [...new Set(warnings)].slice(0, 20);
    out.failedReqs = [...new Set(failedReqs)].slice(0, 20);
    out.elapsed = Math.round((Date.now() - t0) / 1000);
    if (winSeen) out.winText = await page.evaluate(() => ({
        name: document.getElementById('win-name').textContent,
        sub: document.getElementById('win-subtitle').textContent,
        cards: document.getElementById('win-cards').innerText,
    }));

    fs.writeFileSync(path.join(__dirname, `result-${cfgName}.json`), JSON.stringify(out, null, 2));
    await page.screenshot({ path: path.join(__dirname, `shot-${cfgName}.png`) });
    console.log(JSON.stringify({
        config: cfgName, outcome: out.outcome, elapsed: out.elapsed, acted: rep.acted,
        pageErrors: out.pageErrors.length, consoleErrors: out.consoleErrors.length,
        invariants: rep.invariantViolations, minigames: rep.minigames.length,
        states: rep.states, lastResult,
    }, null, 2));
    await browser.close();
})();

async function visibleOverlays(page) {
    return page.evaluate(() => {
        const ids = ['splash', 'char-select', 'map-select', 'win-screen', 'modal-overlay', 'msg-modal',
            'shop-modal', 'shop-offer-modal', 'drop-modal', 'use-modal', 'duel-modal', 'pass-modal',
            'custom-dice-modal', 'gate-overlay', 'minigame-layer', 'mg-intro-overlay', 'map-ui',
            'branch-choice-overlay', 'junction-layer', 'bounty-panel', 'city-briefing', 'ally-arrival',
            'ally-encounter-modal', 'ally-steal-modal', 'hbd-story-overlay',
            'ui-layer', 'p1-actions', 'p2-actions'];
        const outp = {};
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            outp[id] = (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0) ? 'VISIBLE' : 'hidden';
        });
        outp.__neutral = (document.getElementById('mg-neutral') || {}).textContent;
        outp.__msgTitle = (document.getElementById('msg-title') || {}).textContent;
        return outp;
    });
}
