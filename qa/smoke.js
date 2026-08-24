// ============================================================
// Fast boot smoke test — proves the module graph loads, both maps start a real
// 3D game, the new length pickers wire up, and a few turns run clean.
// usage: node smoke.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const results = [];

async function once(browser, label, cfg, chipSel) {
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

    // Length-picker visibility must follow the selected map.
    await page.evaluate(c => {
        window.__QA.startRun({ ...c, __stopBeforeConfirm: true });
    }, cfg);

    const pickerState = await page.evaluate(() => ({
        hbd: getComputedStyle(document.getElementById('hbd-length-select')).display,
        city: getComputedStyle(document.getElementById('city-length-select')).display,
    }));

    if (chipSel) await page.evaluate(sel => { const c = document.querySelector(sel); if (c) c.click(); }, chipSel);

    // Board must actually build (camera exists ⇒ Renderer.init ran).
    let booted = false;
    for (let i = 0; i < 60; i++) {
        booted = await page.evaluate(async () => {
            const R = await import('/src/engine/Renderer.js');
            return !!R.getCamera();
        });
        if (booted) break;
        await page.waitForTimeout(500);
    }

    // Get the match to its first playable turn BEFORE starting the turn budget.
    //
    // The 75s budget below used to be measured from startRun, so it was really
    // "the opening flyover, plus whatever is left". City's flyover is a
    // fixed-duration animation driven by frame deltas and takes ~35-50s of wall
    // clock in this container, which ate the budget and made the probe report a
    // stall that was not one.
    //
    // The wait has to DRIVE step(), not just watch. Both boards deliberately
    // hold at gameState 'INIT' after the flyover until somebody taps their
    // opening card — HBD's story intro, City's briefing — and step() is what
    // taps. A passive waitForFunction on `gameState !== 'INIT'` therefore sat
    // through the full timeout on BOTH boards and reported a 300s "boot" that
    // was really a card waiting for a press.
    let bootMs = 0;
    {
        const b0 = Date.now();
        while ((Date.now() - b0) / 1000 < 300) {
            const gs = await page.evaluate(() => window.__QA.snapshot().gameState);
            if (gs && gs !== 'INIT') break;
            await page.evaluate(() => window.__QA.step());
            await page.waitForTimeout(150);
        }
        bootMs = Date.now() - b0;
    }

    // Run a short burst of real turns.
    //
    // This used to be a flat 75-second wall-clock budget, which quietly assumed
    // a turn is quick. On City in this container a turn takes ~30s (verify.js
    // measures it), so 75s could yield at most two — and the assertion below
    // wants two. One slow minigame and the probe reported a stall.
    //
    // The budget is now "keep going until enough turns have run, up to a
    // generous ceiling". The ASSERTION is unchanged (still >= 2 turns); what
    // changed is that wall-clock speed no longer decides the outcome.
    const TARGET_TURNS = 4, CEILING_S = 300;
    const t0 = Date.now();
    await page.evaluate(() => window.__QA.setMinigameFastResolve(2000));
    while ((Date.now() - t0) / 1000 < CEILING_S) {
        const r = await page.evaluate(() => window.__QA.step());
        if (r === 'WIN_SCREEN' || r === 'BOOT_ERROR') break;
        if (await page.evaluate(() => window.__QA.snapshot().totalTurns) >= TARGET_TURNS) break;
        await page.waitForTimeout(110);
    }
    const snap = await page.evaluate(() => window.__QA.snapshot());
    const rep = await page.evaluate(() => window.__QA.report());
    const roundText = await page.evaluate(() => document.getElementById('round-counter').textContent);
    const mapBtn = await page.evaluate(() => getComputedStyle(document.querySelector('[data-map="0"]')).display);

    results.push({ label, booted, bootMs, playMs: Date.now() - t0, pickerState, snap, roundText, mapBtnDisplay: mapBtn,
                   invariants: rep.invariantViolations, errors: [...new Set(errors)], turns: snap.totalTurns });
    await page.screenshot({ path: path.join(__dirname, `shot-smoke-${label}.png`) });
    await ctx.close();
}

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    await once(browser, 'city6', { mode: '1p', difficulty: 'medium', map: 'city_circuit' }, '[data-city-rounds="6"]');
    await once(browser, 'hbd50', { mode: '1p', difficulty: 'hard', map: 'hundred_block_dash', len: 50 }, null);
    await browser.close();

    fs.writeFileSync(path.join(__dirname, 'result-smoke.json'), JSON.stringify(results, null, 2));
    let bad = 0;
    for (const r of results) {
        const problems = [];
        if (!r.booted) problems.push('BOARD DID NOT BUILD');
        if (r.errors.length) problems.push('errors: ' + r.errors.slice(0, 3).join(' | '));
        if (r.invariants.length) problems.push('invariants: ' + r.invariants.join(', '));
        if (r.turns < 2) problems.push('only ' + r.turns + ' turns ran');
        if (problems.length) bad++;
        console.log(`${problems.length ? 'FAIL' : 'OK  '} ${r.label}  booted=${r.booted} turns=${r.turns} ` +
                    `boot=${(r.bootMs/1000).toFixed(1)}s play=${(r.playMs/1000).toFixed(1)}s round="${r.roundText}" mapBtn=${r.mapBtnDisplay} ` +
                    `pickers(hbd=${r.pickerState.hbd},city=${r.pickerState.city})`);
        problems.forEach(p => console.log('       - ' + p));
    }
    console.log(bad ? `\n${bad} configuration(s) failed` : '\nsmoke: all clean');
    process.exit(bad ? 1 : 0);
})();
