// ============================================================
// RELEASE AUDIT — the fixes from docs/RELEASE_AUDIT_2026-09.md, proven.
//
//   UX-01  the briefing's START is on screen without scrolling (4 sizes)
//   UX-02  a tap skips the opening flyover; the second briefing is compact
//   G-02   the human's own turn banner says YOUR TURN
//   G-01   a real tap on ❓ during your turn opens the rules
//   RA-04  ⏸ pauses: a bot turn does not advance while paused, and does after
//          resume; the page going hidden pauses; Back pauses
//   CAM-01 a 60-unit jump of the target is crossed over several frames, not cut
//   C-02   no junction spheres; RA-03 shadow casters pruned, resolution adapts
//   RA-05  the bot is not called Borat
//   RA-06  no visible text renders in a serif face (fonts are offline here)
//   A-01   Reduce Motion: the flyover is a moment, not 9 s
//   UX-04  the win screen opens upright on a phone held upright
//
// usage: node release.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function boot(browser, { w = 390, h = 844, reduce = false, seen = false, dpr = 1 } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(seen => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); if (seen) localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} }, seen);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    return { ctx, page, errors };
}
const shown = (page, id) => page.evaluate(id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; }, id);
const center = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; }, sel);

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });

    const ONLY = process.env.ONLY || '';
    if (!ONLY) {
    // ---------------- fonts, before anything else draws ----------------
    {
        const { ctx, page } = await boot(browser);
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
        const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
        const serif = [];
        for (const sel of ['#splash .stitle', '#splash .screen-content > div:nth-child(2)', '[data-mode="1p"]', '[data-mode="1p"] span', '#btn-next', '#btn-minigames']) {
            const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
            if (!nodeId) continue;
            const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
            const fam = fonts.map(f => f.familyName).join('+');
            if (/serif|times|charter|georgia/i.test(fam) && !/sans/i.test(fam)) serif.push(`${sel}: ${fam}`);
        }
        ok('RA-06 no splash text renders in a serif face with Google Fonts unreachable', serif.length === 0, serif.join(' | ') || 'all sans');
        await ctx.close();
    }

    // ---------------- the briefing button, four sizes ----------------
    for (const [w, h] of [[375, 667], [390, 844], [430, 932], [844, 390]]) {
        const { ctx, page } = await boot(browser, { w, h });
        await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', keepBriefing: true, rounds: 6 }));
        // A tap during the flyover skips it (only measured on the first size).
        let skipMs = null;
        if (w === 375) {
            await page.waitForFunction(() => window.__QA.snapshot().gameState === 'INIT' && !!document.querySelector('#game-container canvas'), null, { timeout: 60000 });
            await page.waitForTimeout(1500);
            const t = Date.now();
            await page.mouse.click(w / 2, h / 2);
            await page.waitForFunction(() => getComputedStyle(document.getElementById('city-briefing')).display !== 'none', null, { timeout: 120000 });
            skipMs = Date.now() - t;
        }
        await page.waitForFunction(() => getComputedStyle(document.getElementById('city-briefing')).display !== 'none', null, { timeout: 300000 });
        const b = await center(page, '#btn-cb-start');
        ok(`UX-01 START is on screen at ${w}x${h}`, b && b.bottom <= h && b.top >= 0, b ? `top ${Math.round(b.top)} bottom ${Math.round(b.bottom)} of ${h}` : 'missing');
        if (skipMs !== null) ok('UX-02 a tap skips the opening flyover', skipMs < 8000, `briefing ${skipMs} ms after the tap (flyover alone is 9000 ms of game time)`);
        await ctx.close();
    }

    // ---------------- the main run ----------------
    const { page, errors } = await boot(browser);
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', keepBriefing: true, rounds: 6 }));
    await page.waitForFunction(() => getComputedStyle(document.getElementById('city-briefing')).display !== 'none', null, { timeout: 300000 });
    const compact1 = await page.evaluate(() => document.getElementById('city-briefing').classList.contains('cb-compact'));
    const st = await center(page, '#btn-cb-start');
    await page.mouse.click(st.x, st.y);            // a real tap, no scrolling
    // Watch the turn banner from the first frame of play.
    await page.evaluate(() => {
        window.__banners = [];
        const iv = setInterval(() => {
            const el = document.getElementById('turn-banner');
            if (el && getComputedStyle(el).display !== 'none') { const t = el.innerText.replace(/\s+/g, ' ').trim(); if (!window.__banners.includes(t)) window.__banners.push(t); }
        }, 50);
        setTimeout(() => clearInterval(iv), 600000);
    });
    await page.waitForFunction(() => { const s = window.__QA.snapshot(); return s.gameState === 'PRE_ROLL' && s.activePlayer === 0; }, null, { timeout: 600000, polling: 300 });
    await page.waitForTimeout(1200);
    const banners = await page.evaluate(() => window.__banners);
    const mine = banners.find(t => /PLAYER 1/i.test(t)) || '';
    ok('G-02 the human\'s own turn banner says YOUR TURN', /YOUR TURN/i.test(mine) && !/waiting on them/i.test(mine), mine || JSON.stringify(banners));
    const botName = await page.evaluate(() => window.__QA.snapshot && document.getElementById('hud-rivals')?.innerText + ' ' + (document.getElementById('hud-name-p2')?.innerText || ''));
    ok('RA-05 the bot is not called Borat', !/borat/i.test(botName) && /bolt/i.test(botName), botName.replace(/\s+/g, ' ').slice(0, 60));
    ok('UX-02 first briefing is full (lore shown)', compact1 === false);

    // ❓ during your own turn.
    const q = await center(page, '#btn-rules');
    await page.mouse.click(q.x, q.y);
    await page.waitForTimeout(500);
    ok('G-01 a real tap on ❓ during your turn opens the rules', await shown(page, 'rules-overlay'), `${Math.round(q.w)}x${Math.round(q.h)}`);
    await page.evaluate(() => document.getElementById('rules-close').click());

    // Scene checks.
    const scene = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        let spheres = 0, casters = 0;
        R.getScene().traverse(o => {
            if (o.isMesh && o.geometry?.type === 'SphereGeometry' && o.geometry.parameters.radius === 1.8 && o.material?.color?.getHex() === 0xfbbf24) spheres++;
            if (o.isMesh && o.castShadow) casters++;
        });
        return { spheres, casters, q: R.getQuality() };
    });
    ok('C-02 no glowing junction spheres on the road', scene.spheres === 0, `${scene.spheres}`);
    ok('RA-03 shadow casters pruned (was 1,007)', scene.casters < 600, `${scene.casters}`);

    // Pause: roll, then hold the match still for a few seconds.
    const pz = await center(page, '#btn-pause');
    await page.mouse.click(pz.x, pz.y);
    await page.waitForTimeout(400);
    const pausedA = await page.evaluate(async () => { const D = await import('/src/core/Director.js'); return { open: getComputedStyle(document.getElementById('pause-overlay')).display !== 'none', d: D.debugState().paused }; });
    ok('RA-04 ⏸ opens the pause menu and stops the match clock', pausedA.open && pausedA.d, JSON.stringify(pausedA));
    await page.evaluate(() => document.getElementById('pause-resume').click());

    // Let P1 roll, then pause during the BOT's turn and check it stands still.
    const roll = await page.evaluate(() => { const b = [...document.querySelectorAll('#p1-actions button')].find(x => /roll/i.test(x.innerText)); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(roll.x, roll.y);
    const auto = setInterval(() => page.evaluate(() => {
        // Answer whatever P1 is asked, so the turn hands over.
        for (const id of ['btn-msg-continue', 'btn-shop-offer-skip', 'btn-close-shop', 'btn-duel-skip', 'btn-ally-pass', 'btn-cancel-drop']) {
            const b = document.getElementById(id); if (b && b.offsetParent) { b.click(); return; }
        }
        const j = document.querySelector('#junction-arrows button'); if (j && j.offsetParent) j.click();
        const bet = document.querySelector('#duel-bet-options button'); if (bet && bet.offsetParent) bet.click();
    }).catch(() => {}), 700);
    await page.waitForFunction(() => { const s = window.__QA.snapshot(); return s.activePlayer === 1 && s.gameState === 'PRE_ROLL'; }, null, { timeout: 400000, polling: 200 });
    clearInterval(auto);
    await page.evaluate(async () => { (await import('/src/ui/PauseMenu.js')).open(); });
    const before = await page.evaluate(() => JSON.stringify(window.__QA.snapshot()));
    await page.waitForTimeout(6000);
    const during = await page.evaluate(() => JSON.stringify(window.__QA.snapshot()));
    ok('RA-04 a bot turn does not advance while paused (6 s)', before === during);
    await page.evaluate(async () => { (await import('/src/ui/PauseMenu.js')).close(); });
    await page.waitForFunction(b => JSON.stringify(window.__QA.snapshot()) !== b, before, { timeout: 120000, polling: 300 }).catch(() => {});
    const after = await page.evaluate(() => JSON.stringify(window.__QA.snapshot()));
    ok('RA-04 …and carries on after RESUME', after !== before);

    // Hidden page and Back both pause.
    await page.waitForFunction(() => { const s = window.__QA.snapshot(); return s.gameState === 'PRE_ROLL' || s.gameState === 'ROLLING' || s.gameState === 'MOVING'; }, null, { timeout: 120000, polling: 200 }).catch(() => {});
    const hid = await page.evaluate(async () => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        const P = await import('/src/ui/PauseMenu.js');
        const o = P.isOpen(); P.close();
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        return o;
    });
    ok('RA-04 the page going hidden pauses the match', hid);
    await page.goBack().catch(() => {});
    await page.waitForTimeout(500);
    const back = await page.evaluate(async () => { const P = await import('/src/ui/PauseMenu.js'); const o = P.isOpen(); P.close(); return o; });
    ok('RA-04 Back opens the pause menu instead of leaving', back && page.url().includes('index.html'));

    // Camera: throw the target 60 units and watch the camera cross, frame by frame.
    await page.waitForFunction(() => { const s = window.__QA.snapshot(); return s.gameState === 'PRE_ROLL'; }, null, { timeout: 300000, polling: 200 });
    const cam = await page.evaluate(() => new Promise(async res => {
        const R = await import('/src/engine/Renderer.js');
        const { state } = await import('/src/core/GameState.js');
        const p = state.players[state.activePlayer];
        const c = R.getCamera();
        const start = c.position.clone();
        p.mesh.position.x += 42; p.mesh.position.z += 42;          // ~60 units away
        const steps = []; let prev = start.clone(), n = 0;
        const tick = () => {
            const d = c.position.distanceTo(prev); prev = c.position.clone(); steps.push(+d.toFixed(2));
            if (++n < 40) requestAnimationFrame(tick);
            else { p.mesh.position.x -= 42; p.mesh.position.z -= 42; res({ steps, total: +start.distanceTo(c.position).toFixed(1) }); }
        };
        requestAnimationFrame(tick);
    }));
    const maxStep = Math.max(...cam.steps);
    ok('CAM-01 a 60-unit jump is crossed over several frames, not cut in one', maxStep < cam.total * 0.5 && cam.steps.filter(s => s > 0.5).length >= 3, `largest frame ${maxStep} of ${cam.total} total · ${cam.steps.slice(0, 12).join(',')}`);

    // Win screen, straight from the controller, on a phone held upright.
    const win = await page.evaluate(async () => {
        const W = await import('/src/core/WinScreen.js');
        const fn = () => W.calculateWinner(false);
        if (typeof fn === 'function') fn(); else return { skipped: Object.keys(W) };
        await new Promise(r => setTimeout(r, 400));
        return { portrait: document.getElementById('win-screen').classList.contains('portrait') };
    });
    if (win.skipped) ok('UX-04 win screen opened', false, 'no export to call: ' + win.skipped.join(','));
    else ok('UX-04 the win screen opens upright on a phone held upright', win.portrait);
    ok('no page errors in the main run', errors.length === 0, errors.slice(0, 3).join(' | '));

    }   // end of !ONLY
    // ---------------- second match: the briefing is compact; Reduce Motion ----------------
    {
        // DPR 2, like a phone: the board starts at 2 and, with this software
        // GPU's frames far past 33 ms, has to step itself down.
        const { ctx, page } = await boot(browser, { reduce: true, seen: true, dpr: 2 });
        await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', keepBriefing: true, rounds: 6 }));
        await page.waitForFunction(() => window.__QA.snapshot().gameState === 'INIT' && !!document.querySelector('#game-container canvas'), null, { timeout: 60000 });
        const t = Date.now();
        await page.waitForFunction(() => getComputedStyle(document.getElementById('city-briefing')).display !== 'none', null, { timeout: 120000 });
        const ms = Date.now() - t;
        const compact = await page.evaluate(() => document.getElementById('city-briefing').classList.contains('cb-compact'));
        ok('A-01 Reduce Motion: the flyover is a moment, not 9 s', ms < 6000, `${ms} ms to the briefing, no tap`);
        ok('UX-02 a returning player gets the compact briefing', compact);
        await page.waitForTimeout(2500);
        const q = await page.evaluate(async () => (await import('/src/engine/Renderer.js')).getQuality());
        ok('RA-03 the board steps its resolution down when frames run long (DPR 2 phone)', q.drops >= 1 && q.ratio <= 1.5, JSON.stringify(q));
        await ctx.close();
    }

    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
