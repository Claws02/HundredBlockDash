// ============================================================
// In-game verification: renderer leak + pacing + endgame/win-screen path.
// Runs on a clean page that does nothing but start a real game.
// usage: node verify2.js <map> [rounds]
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const MAP = process.argv[2] || 'city_circuit';
const ROUNDS = parseInt(process.argv[3] || '6', 10);

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    const cfg = MAP === 'city_circuit'
        ? { mode: '1p', difficulty: 'medium', map: 'city_circuit', cityRounds: ROUNDS }
        : { mode: '1p', difficulty: 'medium', map: 'hundred_block_dash', len: 50 };

    await page.evaluate(c => {
        window.__QA.startRun(c);
        if (c.cityRounds) {
            const chip = document.querySelector(`[data-city-rounds="${c.cityRounds}"]`);
            if (chip) chip.click();
        }
    }, cfg);

    // Wait for the 3D board to actually exist (camera present = Renderer.init ran).
    let booted = false;
    for (let i = 0; i < 120; i++) {
        booted = await page.evaluate(async () => {
            const R = await import('/src/engine/Renderer.js');
            return !!R.getCamera();
        });
        if (booted) break;
        await page.waitForTimeout(500);
    }
    const out = { map: MAP, rounds: ROUNDS, booted };
    if (!booted) {
        out.diag = await page.evaluate(() => ({ snap: window.__QA.snapshot(), report: window.__QA.report() }));
        fs.writeFileSync(path.join(__dirname, `result-verify2-${MAP}.json`), JSON.stringify(out, null, 2));
        console.log('BOOT FAILED', JSON.stringify(out.diag.snap));
        console.log('log tail', JSON.stringify(out.diag.report.log.slice(-8)));
        await browser.close(); process.exit(1);
    }
    await page.waitForTimeout(2500);
    out.cityRoundsSelected = await page.evaluate(() => window.__QA.snapshot());

    // ---- renderer leak ----
    out.leak = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const census = () => {
            let root = R.getCamera(); while (root && root.parent) root = root.parent;
            let meshes = 0; const geos = new Set(), mats = new Set();
            root.traverse(n => {
                if (n.isMesh || n.isPoints || n.isLine) {
                    meshes++;
                    if (n.geometry) geos.add(n.geometry.uuid);
                    (Array.isArray(n.material) ? n.material : n.material ? [n.material] : []).forEach(m => mats.add(m.uuid));
                }
            });
            return { meshes, geos: geos.size, mats: mats.size, bobbing: R.getActiveAnims().length };
        };
        const before = census();
        for (let i = 0; i < 12; i++) R.updateSingleTile();
        const after = census();
        return { before, after, redraws: 12 };
    });

    // ---- pacing + full game to the win screen ----
    await page.evaluate(() => window.__QA.setMinigameFastResolve(2500));
    const t0 = Date.now();
    const startTurns = (await page.evaluate(() => window.__QA.snapshot())).totalTurns;
    let mgForced = 0, reachedWin = false, lastR = '';
    const budget = 1500;
    while ((Date.now() - t0) / 1000 < budget) {
        const r = await page.evaluate(() => ({ r: window.__QA.step(), s: window.__QA.snapshot() }));
        lastR = r.r;
        if (String(r.r).startsWith('MG_FORCED')) mgForced++;
        if (r.r === 'WIN_SCREEN') { reachedWin = true; break; }
        await page.waitForTimeout(110);
    }
    const snap = await page.evaluate(() => window.__QA.snapshot());
    const secs = (Date.now() - t0) / 1000;
    const turns = snap.totalTurns - startTurns;
    out.pacing = {
        windowSeconds: Math.round(secs), boardTurns: turns,
        secondsPerBoardTurn: turns ? +(secs / turns).toFixed(1) : null,
        minigamesForceResolved: mgForced, roundReached: snap.round,
        reachedWinScreen: reachedWin, lastResult: lastR,
    };
    if (reachedWin) out.winScreen = await page.evaluate(() => ({
        name: document.getElementById('win-name').textContent,
        sub: document.getElementById('win-subtitle').textContent,
        cards: document.getElementById('win-cards').innerText,
        stats: document.getElementById('win-stats').innerText,
    }));
    out.leakAfterGame = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        let root = R.getCamera(); while (root && root.parent) root = root.parent;
        let meshes = 0; root.traverse(n => { if (n.isMesh || n.isPoints || n.isLine) meshes++; });
        return { meshes, bobbing: R.getActiveAnims().length };
    });
    out.invariants = (await page.evaluate(() => window.__QA.report())).invariantViolations;
    out.errors = [...new Set(errors)];

    fs.writeFileSync(path.join(__dirname, `result-verify2-${MAP}.json`), JSON.stringify(out, null, 2));
    await page.screenshot({ path: path.join(__dirname, `shot-verify2-${MAP}.png`) });
    console.log(JSON.stringify({ booted, leak: out.leak, pacing: out.pacing,
        leakAfterGame: out.leakAfterGame, invariants: out.invariants,
        errors: out.errors.slice(0, 6), win: out.winScreen && out.winScreen.name }, null, 2));
    await browser.close();
})();
