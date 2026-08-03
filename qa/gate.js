// ============================================================
// Gate regression check — the three reported bugs, on HBD, in tabletop mode.
//
//   1. the screen didn't flip back to the player who has to roll
//   2. opening the gate ate that player's turn
//   3. after the gate opened the token moved but the camera didn't follow
//
// The test parks the active player on the gate space, runs the real challenge
// through to a successful roll, and then inspects who owns the turn, which way
// the screen is facing, and where the camera is pointing.
//
// usage: node gate.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // Tabletop 2P: this is the mode where orientation is a real thing that can
    // be wrong. Both players are human, so nothing auto-advances the gate.
    await page.evaluate(() => window.__QA.startRun({ mode: 'tabletop', map: 'hundred_block_dash', len: 50 }));
    // step() is what taps through the opening beats (story card, realm banner).
    // Polling with a bare waitForFunction just parks on the story overlay.
    const bootStart = Date.now();
    let ready = false;
    while (Date.now() - bootStart < 90000) {
        ready = await page.evaluate(async () => {
            const { state } = await import('/src/core/GameState.js');
            return !!state.hbd && state.gameState === 'PRE_ROLL';
        });
        if (ready) break;
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(250);
    }
    ok('boot: tabletop HBD match reaches the first roll', ready);
    if (!ready) { console.log('FAIL: never reached PRE_ROLL'); await browser.close(); process.exit(1); }

    // Park PLAYER 2 on the gate at the start of their turn. Player 2 is the
    // interesting one: the screen has to be flipped 180° for them.
    const setup = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const R = await import('/src/engine/Renderer.js');
        const GC = await import('/src/core/GameController.js');
        const gp = state.hbd.gatePos;
        state.activePlayer = 1;
        const p = state.players[1];
        p.pos = gp; p.prevPos = gp;
        if (p.mesh) p.mesh.position.copy(R.getPos(gp));
        state.gameState = 'PRE_ROLL';
        GC.proceedTurn();
        return { gatePos: gp, gameState: state.gameState };
    });
    await page.waitForTimeout(700);

    const atGate = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return {
            gameState: state.gameState,
            overlay: getComputedStyle(document.getElementById('gate-overlay')).display,
            flipped: document.body.classList.contains('tabletop-p2-turn'),
            active: state.activePlayer,
        };
    });
    ok('gate: parking on the gate raises the challenge', atGate.gameState === 'GATE' && atGate.overlay !== 'none',
       `state=${atGate.gameState} overlay=${atGate.overlay} (gatePos=${setup.gatePos})`);
    ok('BUG 1 — gate: screen is oriented to the player who must roll',
       atGate.flipped === true, `activePlayer=${atGate.active} tabletop-p2-turn=${atGate.flipped}`);

    // Roll the gate for real, retrying failed attempts. A failure ends the turn,
    // so re-park and re-raise until it opens.
    let attempts = 0, opened = false;
    while (attempts++ < 20 && !opened) {
        await page.evaluate(() => document.getElementById('gate-roll-btn')?.click());
        await page.waitForFunction(() =>
            getComputedStyle(document.getElementById('gate-continue-btn')).display !== 'none',
            null, { timeout: 20000 });
        opened = await page.evaluate(async () => (await import('/src/core/GameState.js')).state.gateOpen);
        if (opened) break;
        // Failed: dismiss, then set the board back up for another attempt.
        await page.evaluate(() => document.getElementById('gate-continue-btn').click());
        await page.waitForTimeout(2600);
        await page.evaluate(() => { document.querySelector('#msg-modal')?.click(); document.body.click(); });
        await page.waitForTimeout(1200);
        await page.evaluate(async () => {
            const { state } = await import('/src/core/GameState.js');
            const R = await import('/src/engine/Renderer.js');
            const GC = await import('/src/core/GameController.js');
            state.activePlayer = 1;
            const p = state.players[1];
            p.pos = state.hbd.gatePos; p.prevPos = p.pos;
            if (p.mesh) p.mesh.position.copy(R.getPos(p.pos));
            state.gameState = 'PRE_ROLL';
            GC.proceedTurn();
        });
        await page.waitForTimeout(600);
    }
    ok('gate: a successful roll is reachable', opened, `${attempts} attempt(s)`);

    // Take the success through to the resume.
    const before = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return { pos: state.players[1].pos, turns: state.totalTurns };
    });
    await page.evaluate(() => document.getElementById('gate-continue-btn').click());
    await page.waitForTimeout(2600);   // GATE_RESUME floor is 1600 ms

    const after = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const R = await import('/src/engine/Renderer.js');
        const cam = R.getCamera ? R.getCamera() : null;
        const p = state.players[1];
        const m = p.mesh ? p.mesh.position : null;
        return {
            gameState: state.gameState,
            active: state.activePlayer,
            flipped: document.body.classList.contains('tabletop-p2-turn'),
            rollRow: getComputedStyle(document.getElementById('p2-actions')).display,
            rollBtn: !!document.querySelector('#p2-actions [data-roll="1"]'),
            gateOverlay: getComputedStyle(document.getElementById('gate-overlay')).display,
            camDist: (cam && m) ? Math.hypot(cam.position.x - m.x, cam.position.z - m.z) : -1,
        };
    });

    ok('BUG 2 — gate: opening it does NOT skip the turn; the same player rolls',
       after.active === 1 && after.gameState === 'PRE_ROLL',
       `activePlayer=${after.active} state=${after.gameState} (was P2 at pos ${before.pos}, turn ${before.turns})`);
    ok('gate: the roll button is handed back to that player',
       after.rollBtn && after.rollRow !== 'none', `p2-actions display=${after.rollRow}`);
    ok('gate: the overlay is gone', after.gateOverlay === 'none');
    ok('BUG 1 — gate: screen still faces the roller after the gate closes',
       after.flipped === true, `tabletop-p2-turn=${after.flipped}`);
    ok('BUG 3 — gate: camera is snapped onto the player, not left where the gate scene was',
       after.camDist >= 0 && after.camDist < 30, `camera is ${after.camDist.toFixed(1)} units from the token`);

    // And the resumed roll actually moves them, with the camera keeping up.
    await page.evaluate(() => document.querySelector('#p2-actions [data-roll="1"]').click());
    await page.waitForTimeout(6000);
    const moved = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const R = await import('/src/engine/Renderer.js');
        const cam = R.getCamera ? R.getCamera() : null;
        const m = state.players[1].mesh ? state.players[1].mesh.position : null;
        return {
            pos: state.players[1].pos,
            camDist: (cam && m) ? Math.hypot(cam.position.x - m.x, cam.position.z - m.z) : -1,
        };
    });
    ok('gate: the resumed roll moves the player past the gate',
       moved.pos > before.pos, `${before.pos} → ${moved.pos}`);
    ok('BUG 3 — gate: camera tracks the post-gate movement',
       moved.camDist >= 0 && moved.camDist < 40, `camera is ${moved.camDist.toFixed(1)} units from the token`);

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-gate.json'),
        JSON.stringify({ pass, fail, setup, atGate, before, after, moved, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
