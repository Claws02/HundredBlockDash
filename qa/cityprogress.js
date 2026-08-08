// ============================================================
// Is City Circuit slow, or is it stalling?
//
// A full-match run timed out at both 900 s and 1800 s with zero errors, which
// does not distinguish "a 12-round lap map is simply long" from "something
// stops advancing part way through". This samples the two counters that decide
// the answer — board turns and completed rounds — on a fixed cadence, so the
// shape of the curve tells you which it is.
//
// usage: node cityprogress.js [seconds] [rounds]
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const SECS   = parseInt(process.argv[2] || '600', 10);
const ROUNDS = parseInt(process.argv[3] || '0', 10);   // 0 = leave the default

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(r => {
        window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit' });
        if (r) import('/src/core/GameState.js').then(({ state }) => { state.cityRounds = r; });
    }, ROUNDS);

    const t0 = Date.now();
    let nextSample = 0;
    const samples = [];
    let over = null;

    while ((Date.now() - t0) / 1000 < SECS) {
        await page.evaluate(() => { try { window.__QA.step(); } catch (e) {} });
        await page.waitForTimeout(200);
        const el = (Date.now() - t0) / 1000;
        if (el >= nextSample) {
            nextSample += 30;
            const s = await page.evaluate(async () => {
                const { state } = await import('/src/core/GameState.js');
                return {
                    turns: state.totalTurns, round: state.currentRound,
                    gs: state.gameState, mg: state.mgActive,
                    coins: state.players.map(p => p.coins),
                };
            });
            samples.push({ t: Math.round(el), ...s });
            console.log(`${String(Math.round(el)).padStart(4)}s  turns=${String(s.turns).padStart(3)}  round=${String(s.round).padStart(2)}  ${s.gs}${s.mg ? ' [mg]' : ''}  coins=${s.coins}`);
            if (s.gs === 'GAME_OVER') { over = el; break; }
        }
    }

    const first = samples[0], last = samples[samples.length - 1];
    const turnsPerMin = ((last.turns - first.turns) / ((last.t - first.t) / 60)) || 0;
    console.log('\n--- SUMMARY ---');
    console.log(`finished: ${over ? `yes, at ${Math.round(over)}s` : 'no'}`);
    console.log(`turns: ${first.turns} → ${last.turns}  (${turnsPerMin.toFixed(1)}/min)`);
    console.log(`rounds: ${first.round} → ${last.round} of ${await page.evaluate(async () => (await import('/src/core/GameState.js')).state.cityRounds || 12)}`);
    console.log(`page errors: ${errors.length}`);
    // A stall shows as a flat stretch; a long game shows as a steady climb.
    let flat = 0, worst = 0, run = 0;
    for (let i = 1; i < samples.length; i++) {
        if (samples[i].turns === samples[i - 1].turns) { run++; worst = Math.max(worst, run); flat++; }
        else run = 0;
    }
    console.log(`samples with no turn progress: ${flat}/${samples.length - 1}, longest flat run: ${worst * 30}s`);
    fs.writeFileSync(path.join(__dirname, 'result-cityprogress.json'),
        JSON.stringify({ samples, over, errors }, null, 2));
    await browser.close();
})();
