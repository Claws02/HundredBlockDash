// ============================================================
// REPRO — "the junction arrow scene pops up at the start of a match,
// but only sometimes."
//
// Two things it could be, and they need different fixes:
//
//   (a) The layer is shown when NO branch choice is pending — a leak. Then it
//       is a straight bug and the fix is wherever it is shown or not hidden.
//   (b) The first roll genuinely reaches a fork. Players start on r1 and r5
//       feeds bp_b, so a 5 or a 6 puts the fork on the very first turn — one
//       turn in three. That is correct game logic, and if it looks wrong it is
//       because the fork is landing on top of the opening beats.
//
// This boots a fresh City match N times and records, per boot: the layer's
// visibility through the briefing and the first PRE_ROLL, whether a branch
// choice was actually pending each time it appeared, and what the first roll
// was when it did.
//
// usage: node junctionboot.js [boots]
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const BOOTS = parseInt(process.argv[2] || '14', 10);
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

// Wrapped in parens: page.evaluate() parses a bare "(id) => {...}" string as a
// statement, and an arrow function is not one.
const vis = `((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0;
})`;

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const runs = [];
    const errors = [];

    for (let b = 0; b < BOOTS; b++) {
        const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
        const page = await ctx.newPage();
        page.on('pageerror', e => errors.push(`boot${b}: ${e.message}`));
        await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: AGENT });
        await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
        await page.evaluate(() => window.__QA.bind());
        // keepBriefing so the opening card is not auto-dismissed by the driver.
        await page.evaluate(() => window.__QA.startRun({ mode: 'pass', map: 'city_circuit', keepBriefing: true }));

        // Watch the layer continuously from boot, so a flash is caught too.
        await page.evaluate(() => {
            window.__sight = [];
            window.__watch = setInterval(() => {
                const el = document.getElementById('junction-layer');
                if (!el) return;
                const r = el.getBoundingClientRect();
                const up = getComputedStyle(el).display !== 'none' && r.width > 0;
                if (!up) return;
                const s = window.__QA.snapshot();
                window.__sight.push({
                    gameState: s.gameState, cameraState: s.cameraState,
                    pos: (s.p || []).map(x => x.pos),
                    arrows: document.querySelectorAll('#junction-arrows .j-arrow').length,
                    briefingUp: getComputedStyle(document.getElementById('city-briefing')).display !== 'none',
                    steps: (document.getElementById('junction-steps-num') || {}).textContent,
                });
            }, 90);
        });

        // Let the flyover run and the briefing come up.
        let briefingSeen = false;
        for (let i = 0; i < 90 && !briefingSeen; i++) {
            await page.waitForTimeout(250);
            briefingSeen = await page.evaluate(`${vis}('city-briefing')`);
        }
        const duringBriefing = await page.evaluate(`${vis}('junction-layer')`);

        // Dismiss the briefing and reach the roll.
        await page.evaluate(() => {
            const b = document.getElementById('btn-cb-start') ||
                      document.querySelector('#city-briefing button');
            if (b) b.click();
        });
        let atRoll = false;
        for (let i = 0; i < 120 && !atRoll; i++) {
            await page.waitForTimeout(200);
            atRoll = await page.evaluate(() => window.__QA.snapshot().gameState === 'PRE_ROLL');
        }
        const atPreRoll = await page.evaluate(`${vis}('junction-layer')`);

        // Now take exactly one roll and see whether the fork is legitimately due.
        const rolled = await page.evaluate(async () => {
            const { state } = await import('/src/core/GameState.js');
            const GC = await import('/src/core/GameController.js');
            const start = state.players[state.activePlayer].pos;
            // Deterministic, not a dice throw. Players start on r1 and r5 feeds
            // bp_b, so a 5 is exactly the roll that puts the fork on turn one —
            // and driving the physics dice from a probe gives no way to know
            // what came up, which made a first attempt report 0 forks in 10
            // boots purely because it could not see the result.
            GC.moveThroughGraph(state.players[state.activePlayer], 5);
            // r3 is a SHOP. Walking five from r1 passes it, which suspends the
            // move on the shop-offer modal — an earlier version of this probe
            // never answered it, so the fork never came and the run reported
            // "0 forks in 10 boots" from a stall rather than from the rule.
            let sawFork = false, bannerAtFork = null, toastAtFork = null;
            for (let i = 0; i < 120; i++) {
                await new Promise(r => setTimeout(r, 150));
                const skip = document.getElementById('btn-shop-offer-skip');
                if (skip && skip.offsetParent !== null) skip.click();
                const el = document.getElementById('junction-layer');
                if (el && getComputedStyle(el).display !== 'none') {
                    sawFork = true;
                    const tb = document.getElementById('turn-banner');
                    bannerAtFork = !!tb && getComputedStyle(tb).display !== 'none';
                    toastAtFork = document.querySelectorAll('#toast-box > *').length;
                    break;
                }
                if (state.gameState === 'ACKNOWLEDGE') break;
            }
            return {
                start,
                die: 5,
                forkUp: sawFork, bannerAtFork, toastAtFork,
                gs: state.gameState,
                pos: state.players[state.activePlayer].pos,
            };
        });

        const sightings = await page.evaluate(() => { clearInterval(window.__watch); return window.__sight; });
        runs.push({ boot: b, duringBriefing, atPreRoll, rolled,
                    sightings: sightings.slice(0, 6), sightCount: sightings.length });
        await ctx.close();
        process.stdout.write(duringBriefing || atPreRoll ? 'X' : '.');
    }
    process.stdout.write('\n');
    await browser.close();

    const leaked = runs.filter(r => r.duringBriefing || r.atPreRoll);
    const earlyFork = runs.filter(r => r.rolled.forkUp);

    console.log('\n--- LAYER UP WITH NO CHOICE PENDING (a leak) ---');
    console.log(leaked.length ? JSON.stringify(leaked, null, 1) : `  none in ${BOOTS} boots`);

    console.log('\n--- FORK ON THE VERY FIRST TURN (a roll of 5 from r1 — legitimate) ---');
    console.log(`  ${earlyFork.length} of ${BOOTS} boots`);
    earlyFork.forEach(r => console.log(
        `  boot ${r.boot}: ${r.rolled.start} + die ${r.rolled.die} → fork · turn-banner up: ${r.rolled.bannerAtFork}`
        + ` · toasts on screen: ${r.rolled.toastAtFork}`));


    console.log('\n--- WHAT WAS ON SCREEN EACH TIME THE LAYER APPEARED ---');
    runs.filter(r => r.sightCount).slice(0, 4).forEach(r =>
        console.log(`  boot ${r.boot} (${r.sightCount} samples): ${JSON.stringify(r.sightings[0])}`));

    if (errors.length) console.log('\nPAGE ERRORS:\n  ' + errors.slice(0, 5).join('\n  '));

    fs.writeFileSync(path.join(__dirname, 'result-junctionboot.json'), JSON.stringify(runs, null, 1));
    process.exit(leaked.length ? 1 : 0);
})();
