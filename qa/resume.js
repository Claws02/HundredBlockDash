// ============================================================
// RESUME — a local match survives the app being killed (RELEASE_AUDIT RA-04),
// and the Capacitor hooks do what they say (Back, background, haptics, T-02).
//
//   1. Mid-match, at a turn boundary, a save exists.
//   2. Reload the page (the OS reclaimed the app). The splash offers
//      RESUME MATCH and names the map and round.
//   3. RESUME restores seats, positions, coins, round, whose turn, the board and
//      the bounties exactly, and play carries on without errors.
//   4. With Capacitor's App and Haptics plugins present (mocked), Back opens the
//      pause menu mid-match, the app going inactive pauses, and a haptic goes
//      to the native plugin rather than navigator.vibrate.
//   5. An uncaught error lands in the local diagnostics log.
//   6. Winning or quitting from the pause menu clears the save.
//
// usage: node resume.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

// A stand-in for the Capacitor bridge: records what the game asks of it.
const CAP_MOCK = `
window.__cap = { listeners: {}, impacts: [], exited: 0 };
window.Capacitor = { Plugins: {
    App: { addListener(ev, fn) { (window.__cap.listeners[ev] ||= []).push(fn); return { remove() {} }; }, exitApp() { window.__cap.exited++; } },
    Haptics: { impact(o) { window.__cap.impacts.push(o.style); return Promise.resolve(); } },
} };`;

const snapOf = page => page.evaluate(() => {
    const s = window.__QA.snapshot();
    return JSON.stringify({ ap: s.activePlayer, round: s.round, turns: s.totalTurns, p: s.p.map(x => [x.pos, x.coins, x.inv.join(','), x.allies.join(',')]), contracts: s.contracts, gate: s.gateOpen });
});
const boardSig = page => page.evaluate(async () => {
    const { state } = await import('/src/core/GameState.js');
    return Object.entries(state.board).map(([k, v]) => k + ':' + v.type).sort().join('|').length + ':' + Object.keys(state.board).length;
});

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    // On a stall, say where: partial results, the game state and what is on screen.
    process.on('unhandledRejection', async (e) => {
        console.log('STALL:', e && e.message && e.message.split('\n')[0]);
        try {
            console.log(await page.evaluate(() => {
                const s = window.__QA.snapshot();
                const vis = [...document.querySelectorAll('button')].filter(x => x.offsetParent && x.getBoundingClientRect().width).map(x => x.id || x.innerText.slice(0, 18));
                const ov = [...document.querySelectorAll('[id$=overlay],[id$=modal],#pause-overlay')].filter(x => getComputedStyle(x).display !== 'none').map(x => x.id);
                return JSON.stringify({ gs: s.gameState, ap: s.activePlayer, turns: s.totalTurns, mg: s.mgActive, cam: s.cameraState, vis, ov });
            }));
        } catch (x) { console.log('(no state)', x.message); }
        console.log('PASS so far:'); pass.forEach(p => console.log('  ✓', p));
        fail.forEach(p => console.log('  ✗', p));
        process.exit(2);
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|intentional probe error/.test(m.text())) errors.push(m.text()); });
    // Storage survives the reload: only the first load clears it.
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('booted')) { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); sessionStorage.setItem('booted', '1'); } } catch (e) {} });
    await page.addInitScript(CAP_MOCK);
    const boot = async () => {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: AGENT });
        await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
        await page.evaluate(() => window.__QA.bind());
    };
    await boot();
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));

    // Answer whatever the human is asked, so turns keep changing hands.
    const driver = setInterval(() => page.evaluate(() => {
        const s = window.__QA?.snapshot?.(); if (!s) return;
        for (const id of ['btn-msg-continue', 'btn-shop-offer-skip', 'btn-close-shop', 'btn-duel-skip', 'btn-ally-pass', 'btn-cancel-drop', 'btn-resolve-pass', 'btn-mg-intro-next', 'btn-mg-launch', 'gate-roll-btn', 'gate-continue-btn']) {
            const b = document.getElementById(id); if (b && b.offsetParent) { if (id === 'btn-mg-intro-next') b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true })); else b.click(); return; }
        }
        const j = document.querySelector('#junction-arrows button'); if (j && j.offsetParent) { j.click(); return; }
        const bet = document.querySelector('#duel-bet-options button'); if (bet && bet.offsetParent) { bet.click(); return; }
        if (s.mgActive) import('/src/minigames/MinigameManager.js').then(M => M.endMinigame(Math.random() < .5 ? 0 : 1));
        if (s.gameState === 'PRE_ROLL' && s.activePlayer === 0) { const r = [...document.querySelectorAll('#p1-actions button')].find(x => /roll/i.test(x.innerText)); r && r.click(); }
    }).catch(() => {}), 500);

    // Play until the third turn has begun, so the save is mid-match, not turn 1.
    await page.waitForFunction(() => { const s = window.__QA.snapshot(); return s.totalTurns >= 3 && s.gameState === 'PRE_ROLL'; }, null, { timeout: 900000, polling: 300 });
    clearInterval(driver);
    await page.waitForTimeout(400);
    // The save is written at the top of the turn; freeze the match here.
    await page.evaluate(async () => { (await import('/src/core/Director.js')).pause(); (await import('/src/engine/Renderer.js')).setGamePaused(true); });
    const saved = await page.evaluate(() => { const raw = localStorage.getItem('hbd_saved_match'); return raw ? JSON.parse(JSON.parse(raw)).state.totalTurns : null; });
    const before = await snapOf(page);
    const boardBefore = await boardSig(page);
    ok('1 a save exists at the turn boundary', saved !== null, `saved at turn ${saved}`);

    // ---- the OS kills the app ----
    await boot();
    const resumeBtn = await page.evaluate(() => { const b = document.getElementById('btn-resume'); return b && b.offsetParent ? b.innerText.replace(/\s+/g, ' ') : null; });
    ok('2 the splash offers RESUME MATCH with the map and round', !!resumeBtn && /City Circuit/.test(resumeBtn) && /round/i.test(resumeBtn), resumeBtn || 'not shown');
    const rb = await page.evaluate(() => { const r = document.getElementById('btn-resume').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.mouse.click(...rb);
    await page.waitForFunction(() => { const s = window.__QA.snapshot(); return s.gameState && s.gameState !== 'INIT'; }, null, { timeout: 300000, polling: 300 });
    const after = await snapOf(page);
    const boardAfter = await boardSig(page);
    ok('3 RESUME restores seats, positions, coins, items, buddies, round, turn and bounties', before === after, before === after ? 'identical' : `${before}\n     ≠ ${after}`);
    ok('3 …and the same board', boardBefore === boardAfter, `${boardBefore} / ${boardAfter}`);
    const meshes = await page.evaluate(async () => { const { state } = await import('/src/core/GameState.js'); return state.players.every(p => !!p.mesh); });
    ok('3 …with every figure rebuilt', meshes);

    // Play on a couple of turns after the resume.
    const t0 = await page.evaluate(() => window.__QA.snapshot().totalTurns);
    const driver2 = setInterval(() => page.evaluate(() => {
        const s = window.__QA?.snapshot?.(); if (!s) return;
        for (const id of ['btn-msg-continue', 'btn-shop-offer-skip', 'btn-close-shop', 'btn-duel-skip', 'btn-ally-pass', 'btn-cancel-drop', 'btn-mg-intro-next', 'btn-mg-launch', 'gate-roll-btn', 'gate-continue-btn']) {
            const b = document.getElementById(id); if (b && b.offsetParent) { if (id === 'btn-mg-intro-next') b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true })); else b.click(); return; }
        }
        const j = document.querySelector('#junction-arrows button'); if (j && j.offsetParent) { j.click(); return; }
        const bet = document.querySelector('#duel-bet-options button'); if (bet && bet.offsetParent) { bet.click(); return; }
        if (s.mgActive) import('/src/minigames/MinigameManager.js').then(M => M.endMinigame(0));
        if (s.gameState === 'PRE_ROLL' && s.activePlayer === 0) { const r = [...document.querySelectorAll('#p1-actions button')].find(x => /roll/i.test(x.innerText)); r && r.click(); }
    }).catch(() => {}), 500);
    await page.waitForFunction(t => window.__QA.snapshot().totalTurns >= t + 2, t0, { timeout: 600000, polling: 500 }).catch(() => {});
    const t1 = await page.evaluate(() => window.__QA.snapshot().totalTurns);
    ok('3 play carries on after the resume', t1 >= t0 + 2, `turn ${t0} → ${t1}`);

    // ---- native hooks (mocked Capacitor) ----
    // Keep answering prompts until the board is quiet, or a shop left open
    // would hold the match there for ever.
    await page.waitForFunction(() => { const s = window.__QA.snapshot(); return ['PRE_ROLL', 'ROLLING', 'MOVING'].includes(s.gameState) && !s.mgActive; }, null, { timeout: 300000, polling: 200 });
    clearInterval(driver2);
    const native = await page.evaluate(async () => {
        const P = await import('/src/ui/PauseMenu.js');
        const fire = (ev, arg) => (window.__cap.listeners[ev] || []).forEach(fn => fn(arg));
        const out = { hasBack: !!window.__cap.listeners.backButton, hasState: !!window.__cap.listeners.appStateChange };
        fire('backButton'); out.backOpens = P.isOpen();
        fire('backButton'); out.backCloses = !P.isOpen();
        fire('appStateChange', { isActive: false }); out.inactivePauses = P.isOpen(); P.close();
        const A = await import('/src/engine/AudioManager.js');
        const n0 = window.__cap.impacts.length; A.haptic([80]); A.haptic([10]);
        out.impacts = window.__cap.impacts.slice(n0);
        return out;
    });
    ok('4 native Back opens the pause menu mid-match, and closes it again', native.hasBack && native.backOpens && native.backCloses, JSON.stringify(native));
    ok('4 the app going inactive pauses the match', native.hasState && native.inactivePauses);
    ok('4 haptics go to the native plugin, heavier for longer patterns', native.impacts.join(',') === 'HEAVY,LIGHT', native.impacts.join(','));

    // ---- diagnostics log ----
    await page.evaluate(() => setTimeout(() => { throw new Error('intentional probe error'); }, 0));
    await page.waitForTimeout(300);
    const diag = await page.evaluate(() => (window.hbdDiagnostics ? window.hbdDiagnostics() : []).map(e => e.message));
    ok('5 an uncaught error lands in the local diagnostics log', diag.some(m => /intentional probe error/.test(m)), diag.slice(-2).join(' | '));

    // ---- quitting clears the save ----
    const hadSave = await page.evaluate(() => !!localStorage.getItem('hbd_saved_match'));
    await page.evaluate(async () => { const P = await import('/src/ui/PauseMenu.js'); P.open(); document.getElementById('pause-quit').click(); document.getElementById('pause-quit-yes').click(); });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => !!document.getElementById('splash'), null, { timeout: 30000 });
    const saveAfterQuit = await page.evaluate(() => !!localStorage.getItem('hbd_saved_match'));
    ok('6 LEAVE from the pause menu abandons the match (no save left)', hadSave && !saveAfterQuit, `before ${hadSave} after ${saveAfterQuit}`);

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
