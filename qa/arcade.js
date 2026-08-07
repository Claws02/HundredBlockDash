// ============================================================
// Arcade sweep — launches every minigame from the Minigame Arcade,
// plays it with synthetic input, and verifies it resolves and cleans up.
// usage: node arcade.js [secondsPerGame]
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
// 90s, because the roster's slowest genuine finishes land at 65–70s under
// synthetic input (four in a row, rhythm forge, penalty). The old 45s default
// reported ten of eighteen games "unresolved" when every one of them was
// running cleanly and simply had not reached a winner yet — a budget that
// manufactures failures is worse than no sweep at all.
const PER_GAME = parseInt(process.argv[2] || '90', 10);

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();

    const errsByGame = {};
    let current = 'boot';
    page.on('pageerror', e => { (errsByGame[current] ||= []).push('PAGEERROR: ' + e.message); });
    page.on('console', m => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/Failed to load resource/.test(t)) return; // blocked google fonts in sandbox
        (errsByGame[current] ||= []).push('CONSOLE: ' + t);
    });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    let types = await page.evaluate(() => window.__QA.bind());
    // QA_ONLY=a,b,c limits the sweep to named games — useful for re-running a
    // long-clock game without paying for the whole roster.
    if (process.env.QA_ONLY) {
        const want = process.env.QA_ONLY.split(',').map(x => x.trim());
        types = types.filter(t => want.includes(t));
    }

    const results = [];
    for (const type of types) {
        current = type;
        const t0 = Date.now();
        // Arcade is reached from the splash; triggerStandalone drives it directly.
        await page.evaluate(t => window.__QA.launchArcade(t), type);

        let resolved = false, sawActive = false, lastNeutral = '';
        let leftoverOverlays = -1, mgActiveAfter = null;
        while ((Date.now() - t0) / 1000 < PER_GAME) {
            const st = await page.evaluate(() => {
                try {
                    const r = window.__QA.step();
                    const S = window.__QA.snapshot();
                    return { r, gs: S.gameState, mgActive: S.mgActive,
                             neutral: (document.getElementById('mg-neutral') || {}).textContent,
                             layerVisible: getComputedStyle(document.getElementById('minigame-layer')).display !== 'none',
                             selVisible: getComputedStyle(document.getElementById('mg-select-overlay')).display !== 'none',
                             idless: [...document.getElementById('minigame-layer').children].filter(e => !e.id).length };
                } catch (e) { return { r: 'ERR:' + e.message }; }
            });
            if (st.mgActive) sawActive = true;
            if (st.neutral) lastNeutral = st.neutral;
            // Standalone completion returns to the arcade selector.
            if (sawActive && st.selVisible && !st.layerVisible) {
                resolved = true; leftoverOverlays = st.idless; mgActiveAfter = st.mgActive;
                break;
            }
            await page.waitForTimeout(120);
        }
        const census = await page.evaluate(() => window.__QA.sceneCensus());
        results.push({
            type, resolved, sawActive, seconds: Math.round((Date.now() - t0) / 1000),
            lastNeutral, leftoverOverlays, mgActiveAfter,
            errors: errsByGame[type] ? [...new Set(errsByGame[type])] : [],
            census,
        });
        console.log(`${resolved ? 'OK  ' : 'FAIL'} ${type.padEnd(12)} ${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s ` +
                    `active=${sawActive} leftoverOverlays=${leftoverOverlays} errs=${(errsByGame[type] || []).length} ` +
                    `| ${(lastNeutral || '').slice(0, 42)}`);

        // If it never resolved, force back to a clean arcade state so the next game can run.
        if (!resolved) {
            await page.evaluate(async () => {
                const M = await import('/src/minigames/MinigameManager.js');
                try { M.endMinigame(-1); } catch (e) {}
                document.getElementById('mg-select-overlay').style.display = 'flex';
                document.getElementById('minigame-layer').style.display = 'none';
            });
            await page.waitForTimeout(400);
        }
    }

    fs.writeFileSync(path.join(__dirname, 'result-arcade.json'), JSON.stringify(results, null, 2));
    const failed = results.filter(r => !r.resolved).map(r => r.type);
    const withErrs = results.filter(r => r.errors.length).map(r => r.type + '(' + r.errors.length + ')');
    console.log('\n--- SUMMARY ---');
    console.log('unresolved:', failed.length ? failed.join(', ') : 'none');
    console.log('with errors:', withErrs.length ? withErrs.join(', ') : 'none');
    console.log('mesh count drift:', results.map(r => r.type + '=' + r.census.meshes).join(' '));
    await browser.close();
})();
