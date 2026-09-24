// ============================================================
// WAVE 3 — map, framing and layouts.
//   C-05  the map opens on the whole circuit, clear of the map sheet.
//   C-06  a token that leaves the frame is brought back into it.
//   UX-09 a landscape phone on the board is asked to turn upright.
//   UX-10 a tablet gets html.is-tablet and 1.25x text.
// Writes qa/shot-wave3-{map,landscape,tablet}.png.
// usage: node wave3.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function boardPage(browser, viewport) {
    const ctx = await browser.newContext({ viewport, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); localStorage.setItem('hbd_coached', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    return { ctx, page, errors };
}
async function toFirstRoll(page) {
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
        const st = await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            for (const id of ['btn-msg-continue', 'btn-cb-start']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            return window.__QA.snapshot();
        }).catch(() => ({}));
        if (st.gameState === 'PRE_ROLL' && st.activePlayer === 0) return true;
        await page.waitForTimeout(700);
    }
    return false;
}

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const allErrors = [];

    // ---- Portrait phone: map and framing ----
    {
        const { ctx, page, errors } = await boardPage(browser, { width: 390, height: 844 });
        await toFirstRoll(page);
        await page.evaluate(async () => (await import('/src/ui/UIManager.js')).openMap());
        await page.waitForTimeout(6000);
        const fit = await page.evaluate(async () => {
            const R = await import('/src/engine/Renderer.js');
            const { state } = await import('/src/core/GameState.js');
            // The map camera eases toward its pose, which at a software GPU's
            // 1–3 fps takes longer than a probe should wait. Check the pose it
            // is heading for (what the fit controls), and that it is heading there.
            const live = R.getCamera();
            const cam = live.clone();
            cam.position.copy(R.mapCamera.targetPos); cam.lookAt(R.mapCamera.targetLook); cam.updateMatrixWorld(true);
            const d0 = live.position.distanceTo(R.mapCamera.targetPos);
            await new Promise(r => setTimeout(r, 2000));
            const d1 = live.position.distanceTo(R.mapCamera.targetPos);
            const panel = document.querySelector('#map-ui .map-panel');
            const sheetTop = panel ? panel.getBoundingClientRect().top : innerHeight;
            let out = 0, under = 0, n = 0, minX = 1, maxX = -1, minY = 1, maxY = -1;
            Object.keys(state.board).forEach(id => {
                const p = R.getPos(id); if (!p) return;
                const v = p.clone().project(cam); n++;
                minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
                if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) out++;
                const sy = (1 - v.y) / 2 * innerHeight;
                if (sy > sheetTop) under++;
            });
            return { n, out, under, span: +(maxX - minX).toFixed(2), cam: state.cameraState, closing: [+d0.toFixed(1), +d1.toFixed(1)] };
        });
        // For the picture: put the camera where it is going.
        await page.evaluate(async () => { const R = await import('/src/engine/Renderer.js'); const c = R.getCamera(); c.position.copy(R.mapCamera.targetPos); c.lookAt(R.mapCamera.targetLook); });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(__dirname, 'shot-wave3-map.png') });
        ok('C-05 the map shows every space of the circuit', fit.out === 0, JSON.stringify(fit));
        ok('C-05 …and none hides under the map sheet', fit.under === 0, JSON.stringify(fit));
        ok('C-05 …filling the width (span ≥ 1.2 of 2)', fit.span >= 1.2 && fit.span <= 2, JSON.stringify(fit));
        ok('C-05 the camera is on its way there', fit.closing[1] < fit.closing[0] || fit.closing[1] < 1, JSON.stringify(fit.closing));
        await page.evaluate(async () => (await import('/src/ui/UIManager.js')).closeMap?.());
        await page.evaluate(() => { const b = document.getElementById('btn-map-close') || document.querySelector('#map-ui .map-close'); b && b.click(); });
        await page.waitForTimeout(2500);

        // Throw the token out of frame; the follow camera must bring it back.
        const back = await page.evaluate(async () => {
            const R = await import('/src/engine/Renderer.js');
            const { state } = await import('/src/core/GameState.js');
            const m = state.players[state.activePlayer].mesh, home = m.position.clone();
            const cam = R.getCamera();
            const ndc = () => { cam.updateMatrixWorld(true); const v = m.position.clone().project(cam); return Math.max(Math.abs(v.x), Math.abs(v.y)); };
            const before = ndc();
            m.position.x += 70;
            const t0 = performance.now(); let inAt = null;
            while (performance.now() - t0 < 15000) {
                await new Promise(r => setTimeout(r, 150));
                if (ndc() < 0.8) { inAt = performance.now() - t0; break; }
            }
            m.position.copy(home);
            return { before: +before.toFixed(2), inAt: inAt && Math.round(inAt), cam: state.cameraState };
        });
        ok('C-06 a token thrown out of frame is back in frame', back.inAt !== null, JSON.stringify(back));
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- Landscape phone ----
    {
        const { ctx, page, errors } = await boardPage(browser, { width: 844, height: 390 });
        const splash = await page.evaluate(() => getComputedStyle(document.getElementById('rotate-hint')).display);
        await toFirstRoll(page);
        await page.waitForTimeout(800);
        const board = await page.evaluate(() => getComputedStyle(document.getElementById('rotate-hint')).display);
        await page.screenshot({ path: path.join(__dirname, 'shot-wave3-landscape.png') });
        ok('UX-09 no rotate card on the splash', splash === 'none', splash);
        ok('UX-09 the board in landscape asks to turn upright', board !== 'none', board);
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- Tablet ----
    {
        const { ctx, page, errors } = await boardPage(browser, { width: 768, height: 1024 });
        const t = await page.evaluate(() => ({ tablet: document.documentElement.classList.contains('is-tablet'),
            ts: getComputedStyle(document.documentElement).getPropertyValue('--ts').trim(),
            title: parseFloat(getComputedStyle(document.querySelector('.stitle')).fontSize) }));
        await toFirstRoll(page);
        await page.waitForTimeout(800);
        const hud = await page.evaluate(() => { const el = document.querySelector('#p1-actions .ba-tx'); return el ? parseFloat(getComputedStyle(el).fontSize) : 0; });
        const rot = await page.evaluate(() => getComputedStyle(document.getElementById('rotate-hint')).display);
        await page.screenshot({ path: path.join(__dirname, 'shot-wave3-tablet.png') });
        ok('UX-10 a tablet is recognised and text scales 1.25x', t.tablet && +t.ts === 1.25, JSON.stringify(t));
        ok('UX-10 board buttons scale up on a tablet', hud >= 15, `button font ${hud}px`);
        ok('UX-10 no rotate card on a tablet', rot === 'none', rot);
        allErrors.push(...errors);
        await ctx.close();
    }

    ok('no page errors', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
