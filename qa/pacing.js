// ============================================================
// TURN PACING — does a turn happen in the order a player can follow?
//
// The complaint this exists for: "the player gets teleported to the next spot
// and continues moving before the camera is even caught up, often causing what
// I landed on to already happen before I see what I've landed on."
//
// Three claims, all about ORDER rather than appearance:
//
//   1. JUNCTION WALK — taking a fork moves the token through the fork node and
//      then onto the road, with the camera turned down that road and settled
//      BEFORE the walk starts. It used to be one hop that skipped the fork and
//      covered 26 units in the time an ordinary 10-unit step takes.
//   2. EFFECT ORDERING — nothing happens to the player until the token has
//      landed and the tile has named itself. resolveSpaceEffect() used to run
//      at the top of resolveSpace(), so coins moved while the token was still
//      in the air.
//   3. SWAP CINEMATIC — the swap is a watched event, not a position.copy():
//      the saucer appears, both tokens travel, and the board is left consistent
//      (right nodes, visible, full scale) whichever way the cinematic ends.
//
// usage: node pacing.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text());
    });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: 'pass', map: 'city_circuit' }));
    let ready = false;
    for (let i = 0; i < 400 && !ready; i++) {
        ready = await page.evaluate(() => window.__QA.snapshot().gameState === 'PRE_ROLL');
        if (ready) break;
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(140);
    }
    ok('boot: City match at the roll', ready);

    // ---------------------------------------------------------------
    // 2. Effect ordering. Land on a coin space and watch, frame by frame,
    //    whether the coins move before the tile has named itself.
    // ---------------------------------------------------------------
    const order = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        state.activePlayer = 0;
        const p = state.players[0];
        p.pos = 'r2'; p.prevPos = 'r2';
        p.mesh.position.copy(R.getPos('r2'));
        p.coins = 50;
        state.board['r2'] = { type: 'coin_big' };
        state.gameState = 'MOVING';

        const log = [];
        const t0 = performance.now();
        const iv = setInterval(() => {
            const card = document.getElementById('space-info-card');
            const modal = document.getElementById('msg-modal');
            log.push({
                t: Math.round(performance.now() - t0),
                coins: p.coins,
                tile: card && getComputedStyle(card).display !== 'none',
                result: modal && getComputedStyle(modal).display !== 'none'
                        && getComputedStyle(document.getElementById('modal-overlay')).display !== 'none',
            });
        }, 25);
        GC.resolveSpace(p);
        await new Promise(r => setTimeout(r, 2600));
        clearInterval(iv);

        const firstTile   = log.find(e => e.tile);
        const firstCoins  = log.find(e => e.coins !== 50);
        const firstResult = log.find(e => e.result);
        return {
            tileAt:   firstTile ? firstTile.t : null,
            coinsAt:  firstCoins ? firstCoins.t : null,
            resultAt: firstResult ? firstResult.t : null,
            finalCoins: p.coins,
        };
    });
    ok('order: the tile names itself before anything happens to you',
        order.tileAt !== null && order.coinsAt !== null && order.tileAt < order.coinsAt,
        `tile card at ${order.tileAt}ms, coins moved at ${order.coinsAt}ms`);
    ok('order: the effect gets its own beat before the result card',
        order.coinsAt !== null && order.resultAt !== null && order.coinsAt <= order.resultAt,
        `coins ${order.coinsAt}ms → result card ${order.resultAt}ms`);
    ok('order: the effect still actually fires',
        order.finalCoins > 50, `50 → ${order.finalCoins}`);
    // The gap is the window in which you see WHERE you are. Under ~250ms it is
    // not a beat, it is a stutter.
    ok('order: that window is long enough to read',
        order.coinsAt - order.tileAt >= 250, `${order.coinsAt - order.tileAt}ms`);

    await page.evaluate(async () => {
        const M = await import('/src/ui/ModalManager.js');
        const GC = await import('/src/core/GameController.js');
        M.closeAllModals(); GC.startPreRoll();
    });
    await page.waitForTimeout(600);

    // ---------------------------------------------------------------
    // 1. Junction walk. Park the player one step short of a fork, roll a 1,
    //    and sample the token's path and the camera's aim every frame.
    // ---------------------------------------------------------------
    const walk = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        state.activePlayer = 0;
        const p = state.players[0];
        // r5 is the last ring node before junction bp_b.
        p.pos = 'r5'; p.prevPos = 'r4';
        p.mesh.position.copy(R.getPos('r5'));
        state.gameState = 'MOVING';

        const jPos = R.getPos('bp_b').clone().setY(0);
        const samples = [];
        const cam = R.getCamera();
        const iv = setInterval(() => {
            samples.push({
                t: performance.now(),
                x: p.mesh.position.x, z: p.mesh.position.z,
                nearFork: p.mesh.position.clone().setY(0).distanceTo(jPos),
                camD: cam.position.distanceTo(p.mesh.position),
                gs: state.gameState,
            });
        }, 20);

        GC.moveThroughGraph(p, 1);
        // Answer the fork as a player would, once the arrows are up.
        await new Promise(res => {
            const poll = setInterval(() => {
                const layer = document.getElementById('junction-layer');
                if (layer && getComputedStyle(layer).display !== 'none') {
                    clearInterval(poll);
                    // Always take the district road — the long leg is the one
                    // that used to read as a teleport.
                    const btn = [...layer.querySelectorAll('.j-arrow')]
                        .find(a => !/^r\d/.test(a.dataset.node)) || layer.querySelector('.j-arrow');
                    res(btn ? btn.dataset.node : null);
                    btn && btn.click();
                }
            }, 60);
            setTimeout(() => { clearInterval(poll); res(null); }, 12000);
        });
        await new Promise(r => setTimeout(r, 4500));
        clearInterval(iv);
        return { samples, endPos: p.pos, jPos: { x: jPos.x, z: jPos.z } };
    });

    const s = walk.samples;
    // The token must actually pass through the fork, not jump over it.
    const closest = Math.min(...s.map(e => e.nearFork));
    ok('junction: the token travels THROUGH the fork, not around it',
        closest < 1.6, `closest approach to the fork node: ${closest.toFixed(2)} units`);

    // A sanity bound on ground speed, not the teleport detector — under
    // software GL the frame delta is capped, so a short-duration animation is
    // stretched in wall clock and measures SLOWER, not faster. Reverting the
    // fix makes this number go down, which is why the fork-proximity check
    // above is the one that actually catches a jump cut.
    let biggest = 0;
    for (let i = 1; i < s.length; i++) {
        const d = Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z);
        const dt = (s[i].t - s[i - 1].t) / 1000;
        if (dt > 0 && dt < 0.2) biggest = Math.max(biggest, d / dt);   // units per second
    }
    ok('junction: the token never jump-cuts (ground speed stays sane)',
        biggest < 95, `peak ${biggest.toFixed(0)} units/s`);

    // The camera must be on the player when the walk starts, not chasing it.
    const moving = s.filter(e => Math.hypot(e.x, e.z) > 0);
    const firstMove = moving.findIndex((e, i) =>
        i > 0 && Math.hypot(e.x - moving[i - 1].x, e.z - moving[i - 1].z) > 0.4);
    const camAtStart = firstMove > 0 ? moving[firstMove].camD : null;
    ok('junction: the camera is already on the player when the walk begins',
        camAtStart !== null && camAtStart < 42,
        `camera was ${camAtStart === null ? '?' : camAtStart.toFixed(1)} units from the token at first movement`);
    ok('junction: the walk ends on the chosen road',
        typeof walk.endPos === 'string' && walk.endPos !== 'r5', `ended on ${walk.endPos}`);

    // ---------------------------------------------------------------
    // 3. Swap cinematic, driven through the real space-resolution path.
    // ---------------------------------------------------------------
    await page.evaluate(async () => {
        const M = await import('/src/ui/ModalManager.js');
        const GC = await import('/src/core/GameController.js');
        M.closeAllModals(); GC.startPreRoll();
    });
    await page.waitForTimeout(500);

    const swapStart = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        state.activePlayer = 0;
        state.players[0].pos = 'r2';  state.players[0].mesh.position.copy(R.getPos('r2'));
        state.players[1].pos = 'r12'; state.players[1].mesh.position.copy(R.getPos('r12'));
        state.board['r2'] = { type: 'swap_space' };
        state.gameState = 'MOVING';
        R.snapCameraToActive();
        window.__saw = { ufo: false, beam: 0, camMoved: 0, hidden: false };
        const cam = R.getCamera();
        let last = cam.position.clone();
        window.__iv = setInterval(() => {
            R.getScene().traverse(o => {
                if (o.userData && o.userData.beam) {
                    if (o.visible) window.__saw.ufo = true;
                    if (o.userData.beam.material.opacity > 0.02) window.__saw.beam++;
                }
            });
            window.__saw.camMoved += cam.position.distanceTo(last);
            last = cam.position.clone();
            if (state.players.some(p => p.mesh && !p.mesh.visible)) window.__saw.hidden = true;
        }, 40);
        GC.resolveSpace(state.players[0]);
        return { before: state.players.map(p => p.pos) };
    });

    let card = null;
    for (let i = 0; i < 100 && !card; i++) {
        await page.waitForTimeout(300);
        card = await page.evaluate(() => {
            const m = document.getElementById('msg-modal');
            const shown = m && getComputedStyle(m).display !== 'none'
                && getComputedStyle(document.getElementById('modal-overlay')).display !== 'none';
            return shown ? ((document.getElementById('msg-title') || {}).innerText || '') : null;
        });
    }
    const swapEnd = await page.evaluate(async () => {
        clearInterval(window.__iv);
        const { state } = await import('/src/core/GameState.js');
        return {
            saw: window.__saw,
            pos: state.players.map(p => p.pos),
            cam: state.cameraState,
            meshes: state.players.map(p => ({
                vis: p.mesh.visible, scale: +p.mesh.scale.x.toFixed(2),
                y: +p.mesh.position.y.toFixed(2),
                onNode: p.mesh.position.distanceTo(
                    (window.__R || {}).getPos ? window.__R.getPos(p.pos) : p.mesh.position) < 3,
            })),
        };
    });
    await page.screenshot({ path: path.join(__dirname, 'shot-swap-card.png') });

    ok('swap: the saucer actually appears', swapEnd.saw.ufo);
    ok('swap: the tractor beam fires', swapEnd.saw.beam > 3, `${swapEnd.saw.beam} frames with a lit beam`);
    ok('swap: the camera travels with it', swapEnd.saw.camMoved > 40,
        `${Math.round(swapEnd.saw.camMoved)} units of camera movement`);
    ok('swap: a player is carried out of sight inside the saucer', swapEnd.saw.hidden);
    ok('swap: the two players end on each other\'s nodes',
        swapEnd.pos[0] === swapStart.before[1] && swapEnd.pos[1] === swapStart.before[0],
        `${swapStart.before.join(',')} → ${swapEnd.pos.join(',')}`);
    ok('swap: it raises its own result card', card === 'SWAP ZONE', `card="${card}"`);
    ok('swap: the camera is handed back', swapEnd.cam === 'FOLLOW', swapEnd.cam);
    ok('swap: both tokens are left visible and full size',
        swapEnd.meshes.every(m => m.vis && m.scale === 1 && Math.abs(m.y) < 0.01),
        JSON.stringify(swapEnd.meshes));

    // An interrupted cinematic must not strand a token invisible or at scale 0.
    const rescue = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const R = await import('/src/engine/Renderer.js');
        state.players[0].mesh.visible = false;
        state.players[0].mesh.scale.setScalar(0.02);
        state.players[1].mesh.position.y = 7;
        state.cameraState = 'CINEMATIC';
        R.endSwapCinematic();
        return {
            cam: state.cameraState,
            m: state.players.map(p => ({ vis: p.mesh.visible, s: +p.mesh.scale.x.toFixed(2), y: +p.mesh.position.y.toFixed(2) })),
        };
    });
    ok('swap: an interrupted cinematic can always be undone',
        rescue.cam === 'FOLLOW' && rescue.m.every(m => m.vis && m.s === 1 && m.y === 0),
        JSON.stringify(rescue));

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));

    await browser.close();
    console.log('\nPASS:'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL:'); fail.length ? fail.forEach(f => console.log('  ✗ ' + f)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
