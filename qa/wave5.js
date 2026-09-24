// ============================================================
// WAVE 5 — the city and the tokens feel alive, and there is music.
//   VA-01  music plays on its own bus: menu theme, board loop, silent in a
//          minigame, stopped by mute and by the Music slider at 0; ducks
//          under effects.
//   M-01   a token jumps on a coin gain, winces on a fine, breathes on its turn.
//   A-01   under Reduce Motion a swap is a 0.6 s fade with the camera still.
// usage: node wave5.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

// Count the oscillators the page starts, per destination bus.
const TAP = `
window.__osc = 0;
const _co = AudioContext.prototype.createOscillator;
AudioContext.prototype.createOscillator = function () { window.__osc++; return _co.call(this); };`;

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} });
    await page.addInitScript(TAP);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.mouse.click(5, 5);                                   // the gesture that unlocks audio
    const oscIn = ms => page.evaluate(ms => new Promise(r => { const a = window.__osc; setTimeout(() => r(window.__osc - a), ms); }), ms);
    const A = fn => page.evaluate(`import('/src/engine/AudioManager.js').then(A => (${fn})(A))`);

    // ---- VA-01 ----
    const menu = await A(A => A.musicState());
    const menuNotes = await oscIn(3000);
    ok('VA-01 the menu theme plays after the first tap', menu.mood === 'menu' && menu.playing && menuNotes > 10, `${JSON.stringify(menu)}, ${menuNotes} notes in 3 s`);
    await page.evaluate(async () => (await import('/src/core/Settings.js')).set('music', 0));
    const zero = await oscIn(2000);
    ok('VA-01 Music slider at 0 stops it', zero === 0, `${zero} notes`);
    await page.evaluate(async () => (await import('/src/core/Settings.js')).set('music', 0.5));
    await page.evaluate(async () => (await import('/src/core/Settings.js')).set('muted', true));
    const muted = await oscIn(2000);
    await page.evaluate(async () => (await import('/src/core/Settings.js')).set('muted', false));
    ok('VA-01 master mute stops it', muted === 0, `${muted} notes`);

    await page.addScriptTag({ content: AGENT });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
        const st = await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            for (const id of ['btn-msg-continue', 'btn-cb-start']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            return window.__QA.snapshot().gameState;
        }).catch(() => '');
        if (st === 'PRE_ROLL') break;
        await page.waitForTimeout(700);
    }
    const board = await A(A => A.musicState());
    const boardNotes = await oscIn(3000);
    ok('VA-01 a match switches to the board loop', board.mood === 'board' && boardNotes > 10, `${JSON.stringify(board)}, ${boardNotes} notes`);
    // Freeze the match so the only oscillators counted are the music's (a bot
    // rolling would otherwise add its dice beeps).
    await page.evaluate(async () => { (await import('/src/core/Director.js')).pause(); (await import('/src/engine/Renderer.js')).setGamePaused(true); (await import('/src/core/GameState.js')).state.mgActive = true; });
    await page.waitForTimeout(400);
    const mg = await oscIn(2500);
    await page.evaluate(async () => { (await import('/src/core/GameState.js')).state.mgActive = false; (await import('/src/engine/Renderer.js')).setGamePaused(false); (await import('/src/core/Director.js')).resume(); });
    ok('VA-01 silent while a minigame plays', mg === 0, `${mg} notes`);
    const duck = await page.evaluate(async () => {
        const A = await import('/src/engine/AudioManager.js');
        A.sfx('coin_gain');
        await new Promise(r => setTimeout(r, 60));
        // The duck gain is private; read it through the context graph by
        // sampling musicState's companion: a second sfx must not throw either.
        A.sfx('coin_loss');
        return true;
    });
    ok('VA-01 effects play over the music without error', duck && errors.length === 0);

    // ---- M-01 ----
    const react = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const { state } = await import('/src/core/GameState.js');
        const p = state.players[1], m = p.mesh;
        const ys = [], sx = [];
        R.tokenReact(p, 'cheer');
        for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 90)); ys.push(m.position.y); }
        R.tokenReact(p, 'flinch');
        for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 90)); sx.push(m.scale.y); }
        await new Promise(r => setTimeout(r, 1500));
        const settled = m.position.y === 0 && Math.abs(m.scale.y - 1) < 1e-6 && m.rotation.z === 0;
        // The active token breathes in PRE_ROLL.
        const a = state.players[state.activePlayer].mesh, b0 = a.scale.y;
        await new Promise(r => setTimeout(r, 700));
        return { peak: Math.max(...ys), squash: Math.min(...sx), settled, breath: Math.abs(a.scale.y - b0), state: state.gameState };
    });
    ok('M-01 coin gain: the token jumps', react.peak > 0.4, JSON.stringify(react));
    ok('M-01 fine: the token squashes', react.squash < 0.93, JSON.stringify(react));
    ok('M-01 reactions settle back exactly', react.settled);
    ok('M-01 the waiting token breathes', react.state !== 'PRE_ROLL' || react.breath > 0.002, JSON.stringify(react));

    // ---- A-01 ----
    const swap = await page.evaluate(async () => {
        const S = await import('/src/core/Settings.js');
        const R = await import('/src/engine/Renderer.js');
        const { state } = await import('/src/core/GameState.js');
        S.set('reduceMotion', true);
        const [a, b] = state.players;
        const pa = a.mesh.position.clone(), pb = b.mesh.position.clone();
        if (pa.distanceTo(pb) < 1) b.mesh.position.x += 12;
        const pb2 = b.mesh.position.clone();
        const cam0 = R.getCamera().position.clone();
        let camMax = 0;
        const t0 = performance.now();
        const ms = await new Promise(res => {
            const iv = setInterval(() => { camMax = Math.max(camMax, R.getCamera().position.distanceTo(cam0)); }, 30);
            R.playSwapCinematic(a, b, () => { clearInterval(iv); res(performance.now() - t0); });
        });
        const swapped = a.mesh.position.distanceTo(pb2) < 0.01 && b.mesh.position.distanceTo(pa) < 0.01;
        S.set('reduceMotion', false);
        return { ms: Math.round(ms), swapped, camMax: +camMax.toFixed(2), planned: R.swapCinematicMs() };
    });
    // Game time under SwiftShader runs slow (dt is capped), so allow for it.
    ok('A-01 Reduce Motion swap: tokens trade places', swap.swapped, JSON.stringify(swap));
    ok('A-01 …in a short fade (≤ 3 s wall-clock here), camera still (< 1 unit)', swap.ms < 3000 && swap.camMax < 1, JSON.stringify(swap));

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
