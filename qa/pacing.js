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

    // The buddy report now opens a round, which means it can take the screen on
    // the first startPreRoll() a probe drives. Every reset below calls that, so
    // press through it once here and leave the round marked as reported.
    const clearBuddyReport = async () => {
        for (let i = 0; i < 6; i++) {
            const up = await page.evaluate(() => {
                const el = document.getElementById('ally-arrival');
                return !!el && getComputedStyle(el).display !== 'none';
            });
            if (!up) break;
            await page.evaluate(() => document.getElementById('btn-ally-arrival').click());
            await page.waitForTimeout(400);
        }
    };
    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        // No buddy on the board for the pacing probe at all: its subject is the
        // ORDER of a turn, and a card that owns the screen at the top of
        // startPreRoll is a different test (qa/buddy.js covers it).
        state.allyOnMap = null; R.removeAllyMarker();
        state.players.forEach(p => { p.allies = []; });
        GC.startPreRoll();
    });
    await clearBuddyReport();
    await page.waitForTimeout(400);

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
        // Sample per RENDER FRAME, not on a timer. A setInterval sampler and the
        // render loop run at different rates, so a slow frame puts a whole
        // frame's worth of movement into a 20 ms measured window and reports a
        // ground speed the game never produced. One sample per frame makes the
        // delta and the interval describe the same thing.
        let stop = false;
        (function sample() {
            if (stop) return;
            requestAnimationFrame(sample);
            samples.push({
                t: performance.now(),
                x: p.mesh.position.x, z: p.mesh.position.z,
                nearFork: p.mesh.position.clone().setY(0).distanceTo(jPos),
                camD: cam.position.distanceTo(p.mesh.position),
                gs: state.gameState,
            });
        })();

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
        stop = true;
        return { samples, endPos: p.pos, jPos: { x: jPos.x, z: jPos.z } };
    });

    const s = walk.samples;
    // The token must actually pass through the fork, not jump over it.
    const closest = Math.min(...s.map(e => e.nearFork));
    ok('junction: the token travels THROUGH the fork, not around it',
        closest < 1.6, `closest approach to the fork node: ${closest.toFixed(2)} units`);

    // What actually separates a walk from a jump cut is how LONG the leg takes,
    // not how fast the token is at any instant. Every hop uses a cubic ease-out,
    // whose peak velocity is three times its average and occurs in the first
    // frame — so an instantaneous-speed bound flags a perfectly good hop and
    // was measuring nothing useful. (An earlier version of this probe did
    // exactly that, and had to be told so twice.)
    //
    // The fork → district leg is ~26 world units against ~10 for an ordinary
    // step. It used to be given the same fixed 0.35 s as every other hop, which
    // is what read as a teleport; the duration is now derived from distance.
    // Measured from the token's FIRST movement to the end of the move, so the
    // JUNCTION_COMMIT pause (during which nothing moves) is excluded and this
    // is purely how long the travelling takes. One 0.35 s hop straight to the
    // district ≈ 350 ms; a walk to the fork and then out onto the road ≈ 900 ms.
    const moveSamples = s.filter(e => e.gs === 'MOVING');
    let firstMoveT = null;
    for (let i = 1; i < moveSamples.length; i++) {
        const d = Math.hypot(moveSamples[i].x - moveSamples[0].x, moveSamples[i].z - moveSamples[0].z);
        if (d > 0.5) { firstMoveT = moveSamples[i].t; break; }
    }
    const endT = s.find(e => firstMoveT !== null && e.t > firstMoveT && e.gs !== 'MOVING');
    const legMs = firstMoveT !== null && endT ? Math.round(endT.t - firstMoveT) : null;
    ok('junction: the travelling is walked, not cut',
        legMs !== null && legMs >= 600,
        `${legMs}ms of actual movement`);

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
    // Cancel anything the junction step left in flight. Without this a Director
    // beat from the previous landing can raise a card DURING the swap, and the
    // poll below reads that as "the cinematic finished" while a token is still
    // halfway up the beam.
    await page.evaluate(async () => {
        const M = await import('/src/ui/ModalManager.js');
        const D = await import('/src/core/Director.js');
        const R = await import('/src/engine/Renderer.js');
        const SP = await import('/src/engine/SetPieces.js');
        const GC = await import('/src/core/GameController.js');
        // Director.reset() cancels scheduled beats but NOT animations already
        // running on the renderer's list. The junction step lands on a Back
        // Alley tile, which can be a Magnet or a Duel — both of which are set
        // pieces whose completion raises a card. Left running, that card lands
        // in the middle of the swap and the poll below reads it as "finished"
        // while a token is still halfway up the beam.
        D.reset();
        R.getActiveAnims().length = 0;
        SP.clearSetPieces();
        R.endCinematic();
        M.closeAllModals();
        GC.startPreRoll();
    });
    await page.waitForTimeout(700);

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

    // ---------------------------------------------------------------
    // 4. Notifications must not sit on the board, and must not appear
    //    while it is moving.
    // ---------------------------------------------------------------
    const rail = await page.evaluate(async () => {
        const U = await import('/src/ui/UIManager.js');
        const { state } = await import('/src/core/GameState.js');
        const D = await import('/src/core/Director.js');
        D.reset();
        U.clearToastQueue();

        // While the board is animating, nothing may appear over it.
        state.gameState = 'MOVING';
        U.toast('passed an HQ', '#fbbf24');
        U.toast('claimed a bounty', '#4ade80');
        const duringMove = document.getElementById('toast-box').children.length;
        const queued = U.pendingToastCount();
        // ...unless it is flagged urgent.
        U.toast('shield absorbed it', '#22c55e', { urgent: true });
        const urgentShown = document.getElementById('toast-box').children.length;

        // Landing releases the queue.
        state.gameState = 'ACKNOWLEDGE';
        U.flushToasts();
        await new Promise(r => setTimeout(r, 700));
        const afterFlush = document.getElementById('toast-box').children.length;

        const box = document.getElementById('toast-box').getBoundingClientRect();
        const H = window.innerHeight;
        return {
            duringMove, queued, urgentShown, afterFlush,
            queueEmptied: U.pendingToastCount(),
            // The middle half of the screen is where the board is played.
            top: Math.round(box.top), bottom: Math.round(box.bottom), H,
            inMiddle: box.bottom > H * 0.28 && box.top < H * 0.72,
        };
    });
    ok('toasts: nothing pops up over the board while it is moving',
        rail.duringMove === 0 && rail.queued === 2, JSON.stringify(rail));
    ok('toasts: an urgent one still gets through mid-move',
        rail.urgentShown === 1, `${rail.urgentShown} shown`);
    ok('toasts: the queue is released when the token lands',
        rail.afterFlush > 0 && rail.queueEmptied === 0, JSON.stringify(rail));
    ok('toasts: the rail is clear of the middle of the screen',
        !rail.inMiddle, `rail spans ${rail.top}–${rail.bottom} of ${rail.H}`);
    ok('toasts: at most two at a time',
        rail.afterFlush <= 2, `${rail.afterFlush} stacked`);

    // ---------------------------------------------------------------
    // 4b. The roll callout. The number you rolled must be on screen BEFORE the
    //     token moves, and stay up long enough to read. It is the one
    //     notification that is worthless after the fact — and the mid-move
    //     queue swallowed it, because gameState is 'ROLLING' when the dice
    //     settle, so it appeared once the player had already arrived.
    // ---------------------------------------------------------------
    const roll = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        const D  = await import('/src/core/Director.js');
        const U  = await import('/src/ui/UIManager.js');
        const M  = await import('/src/ui/ModalManager.js');
        D.reset(); R.getActiveAnims().length = 0; M.closeAllModals();
        U.clearToastQueue();

        state.activePlayer = 0;
        const p = state.players[0];
        p.isBot = false;
        p.pos = 'r2'; p.prevPos = 'r1';
        p.mesh.position.copy(R.getPos('r2'));
        const startX = p.mesh.position.x, startZ = p.mesh.position.z;

        // t0 is when the dice SETTLE, not when they are thrown — the throw
        // takes a variable and (in this container) very long time, and it is
        // the gap between the number appearing and the token setting off that
        // this is measuring.
        const log = [];
        let t0 = null;
        const iv = setInterval(() => {
            // The roll is no longer a line of toast — it is a full-screen
            // callout, because the token does not move for DICE_READ anyway and
            // the number is what the turn is about.
            const el = document.getElementById('roll-callout');
            const rolled = !!el && el.classList.contains('up') && !el.classList.contains('out');
            if (rolled && t0 === null) t0 = performance.now();
            if (t0 === null) return;
            const box = el ? el.getBoundingClientRect() : null;
            const num = document.getElementById('rc-num');
            const nbox = num ? num.getBoundingClientRect() : null;
            log.push({
                t: Math.round(performance.now() - t0),
                rolled,
                text: num ? num.textContent : '',
                h: nbox ? Math.round(nbox.height) : 0,
                cx: box ? Math.round(box.left + box.width / 2) : 0,
                moved: Math.hypot(p.mesh.position.x - startX, p.mesh.position.z - startZ) > 0.6,
            });
        }, 25);

        // Drive the REAL roll, dice and all. A synthetic toast would prove the
        // DICE_READ floor but not that the call site marks the callout urgent —
        // and the urgent flag is the whole bug: without it the queue holds the
        // number back until the token has already arrived.
        GC.executeRoll(1.4);
        await new Promise(r => setTimeout(r, 14000));
        clearInterval(iv);

        const shown = log.find(e => e.rolled);
        const moved = log.find(e => e.moved);
        // Was it still up while the token was moving? It should not be.
        const upWhileMoving = log.filter(e => e.moved && e.rolled).length;
        return {
            shownAt: shown ? shown.t : null,
            movedAt: moved ? moved.t : null,
            // The POP animation starts at scale(.55) and getBoundingClientRect
            // returns the transformed box, so the first sample reads about half
            // the real size. Take the largest — that is how big it actually gets.
            digitH: Math.max(0, ...log.map(e => e.h)),
            text: shown ? shown.text : '',
            upWhileMoving,
            samples: log.length,
        };
    });
    ok('roll: the number appears at all',
        roll.shownAt !== null, `${roll.samples} samples taken`);
    ok('roll: the number is on screen before the token moves',
        roll.shownAt !== null && roll.movedAt !== null && roll.shownAt < roll.movedAt,
        `shown at ${roll.shownAt}ms, first movement at ${roll.movedAt}ms`);
    ok('roll: and holds for about a second and a half first',
        roll.movedAt !== null && roll.movedAt >= 1300,
        `${roll.movedAt}ms between the number and the first step`);
    // The whole point of moving it off the toast rail: it is BIG. A line of
    // toast text is about 16px tall.
    ok('roll: it is a full-screen number, not a line of toast',
        roll.digitH >= 80, `digit is ${roll.digitH}px tall, reading "${roll.text}"`);
    // ...and it is gone before the board starts moving, which is what makes it
    // safe to put in the middle of the screen at all.
    ok('roll: and it is off the board before the token sets off',
        roll.upWhileMoving <= 2, `${roll.upWhileMoving} samples with it up mid-move`);

    // ---------------------------------------------------------------
    // 4c. The buddy report no longer holds the minigame back.
    //
    //     It used to: a buddy lands at the CLOSE of a round, which is the same
    //     moment the minigame takes the screen, so the arrival card was raised
    //     there and waited for a press. That put news about the NEXT round in
    //     front of the payoff for the one just finished, four board turns before
    //     anybody could act on it. The card moved to the top of the next round
    //     (qa/buddy.js §2b asserts it there); what this checks is that the
    //     round-end hand-off is clean again.
    // ---------------------------------------------------------------
    const handoff = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const M  = await import('/src/ui/ModalManager.js');
        const D  = await import('/src/core/Director.js');
        const R  = await import('/src/engine/Renderer.js');
        D.reset(); R.getActiveAnims().length = 0; M.closeAllModals();
        document.getElementById('ally-arrival').style.display = 'none';

        // A buddy is on the board and unreported, which is exactly the state
        // that used to stop the minigame.
        state.cityRounds = 6;
        state.currentRound = 1;
        state.allyOnMap = null; R.removeAllyMarker();
        GC.spawnAlly();

        state.totalTurns = 3;            // finishTurn() takes it to a multiple of 4
        state.gameState = 'ACKNOWLEDGE';
        state.players.forEach(p => { p.isBot = false; });
        GC.finishTurn();

        let mgAt = null, cardAt = null;
        const t0 = performance.now();
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 150));
            const el = document.getElementById('ally-arrival');
            if (cardAt === null && el && getComputedStyle(el).display !== 'none') {
                cardAt = Math.round(performance.now() - t0);
            }
            if (mgAt === null && (state.gameState === 'MINIGAME_INTRO' || state.mgActive)) {
                mgAt = Math.round(performance.now() - t0);
                break;
            }
        }
        return { mgAt, cardAt, hadBuddy: !!state.allyOnMap };
    });
    ok('handoff: a buddy on the board no longer stops the round-end minigame',
        handoff.hadBuddy && handoff.mgAt !== null,
        JSON.stringify(handoff));
    ok('handoff: and no card is raised over the hand-off',
        handoff.cardAt === null, `card appeared at ${handoff.cardAt}ms`);

    // ---------------------------------------------------------------
    // 5. The gate: the board stays visible, and items are unavailable.
    // ---------------------------------------------------------------
    const gate = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        const D  = await import('/src/core/Director.js');
        D.reset();
        // The swap card is still up from the previous step and its overlay dims
        // the whole board — which is exactly what this section is asserting the
        // gate no longer does. Clear it first or the screenshot lies.
        (await import('/src/ui/ModalManager.js')).closeAllModals();
        state.gateOpen = false;
        state.activePlayer = 0;
        const p = state.players[0];
        p.pos = 'ind_0'; p.prevPos = 'r16';
        p.mesh.position.copy(R.getPos('ind_0'));
        p.inv = ['shield'];
        p.isBot = false;
        GC.triggerGateChallenge(p);
        await new Promise(r => setTimeout(r, 700));
        const ov = document.getElementById('gate-overlay');
        const cs = getComputedStyle(ov);
        const before = p.inv.length;
        GC.executeUseItem(0, 0);          // must be refused
        return {
            shown: cs.display !== 'none',
            bg: cs.backgroundColor,
            events: cs.pointerEvents,
            uiHidden: getComputedStyle(document.getElementById('ui-layer')).display === 'none',
            cam: state.cameraState,
            // The card must not cover the middle of the screen either.
            card: (r => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) }))(
                document.getElementById('gate-card').getBoundingClientRect()),
            H: window.innerHeight,
            invBefore: before, invAfter: p.inv.length,
        };
    });
    ok('gate: the challenge is on screen', gate.shown);
    ok('gate: the board is NOT blacked out behind it',
        /rgba\(0, 0, 0, 0\)|transparent/.test(gate.bg), gate.bg);
    ok('gate: the layer itself swallows no input', gate.events === 'none', gate.events);
    ok('gate: the camera is pointed at the gate', gate.cam === 'GATE', gate.cam);
    ok('gate: the card hugs an edge and leaves the middle clear',
        gate.card.top > gate.H * 0.45 || gate.card.bottom < gate.H * 0.55,
        `card ${gate.card.top}–${gate.card.bottom} of ${gate.H}`);
    ok('gate: the item bag is unreachable', gate.uiHidden);
    ok('gate: and using an item is refused outright',
        gate.invAfter === gate.invBefore, `${gate.invBefore} → ${gate.invAfter} items`);
    // The gate card and the toast rail are both anchored to an edge; they must
    // not be anchored to the SAME one, or a notification lands on the roll button.
    const railClash = await page.evaluate(() => {
        const box = document.getElementById('toast-box').getBoundingClientRect();
        const card = document.getElementById('gate-card').getBoundingClientRect();
        return { overlap: box.bottom > card.top && box.top < card.bottom,
                 box: [Math.round(box.top), Math.round(box.bottom)],
                 card: [Math.round(card.top), Math.round(card.bottom)] };
    });
    ok('gate: the toast rail is not sitting on the gate card',
        !railClash.overlap, JSON.stringify(railClash));
    await page.screenshot({ path: path.join(__dirname, 'shot-gate.png') });

    // The breach itself.
    const breach = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const SP = await import('/src/engine/SetPieces.js');
        const R  = await import('/src/engine/Renderer.js');
        let peak = 0;
        const count = () => { let n = 0; R.getScene().traverse(o => { if (o.isMesh) n++; }); return n; };
        const base = count();
        await new Promise(res => {
            SP.gateBreach(R.getPos(state.players[0].pos), res);
            const iv = setInterval(() => { peak = Math.max(peak, count()); }, 60);
            setTimeout(() => clearInterval(iv), 2600);
        });
        await new Promise(r => setTimeout(r, 400));
        return { base, peak, after: count(), cam: state.cameraState };
    });
    ok('gate: the breach actually puts shards on the board',
        breach.peak > breach.base + 8, `${breach.base} → peak ${breach.peak}`);
    ok('gate: and cleans every one of them up',
        breach.after === breach.base, `${breach.base} → ${breach.after}`);

    // ---------------------------------------------------------------
    // 5b. Failing the gate leaves you AT the gate.
    //
    // Reported: "the district with the gate did cause a glitch, I was stuck at
    // the gate, then the next round I was at the junction and was able to roll
    // and move along." Failing the City gate teleported the player to 'bp_d' —
    // a junction, which has no board tile — and startPreRoll only ever checked
    // the HBD gate, so the next turn was an ordinary roll and the gate was
    // simply forgotten. The card said "try again next turn"; nothing did.
    // ---------------------------------------------------------------
    const held = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const M  = await import('/src/ui/ModalManager.js');
        const D  = await import('/src/core/Director.js');
        const R  = await import('/src/engine/Renderer.js');
        D.reset(); R.getActiveAnims().length = 0; M.closeAllModals();
        state.gateOpen = false;
        state.activePlayer = 0;
        const p = state.players[0];
        p.isBot = false;
        p.pos = 'ind_0'; p.mesh.position.copy(R.getPos('ind_0'));
        // Drive closeGate() down the failure branch directly: the dice roll is
        // random, and this is about where the player ends up, not the odds.
        document.getElementById('gate-overlay').dataset.pid = '0';
        GC.closeGate();
        await new Promise(r => setTimeout(r, 500));
        const G = window.CITY_GRAPH_REF;
        return {
            pos: p.pos,
            onJunction: !!(G[p.pos] && G[p.pos].isJunction),
            hasTile: !!state.board[p.pos],
        };
    });
    ok('gate: failing it leaves you standing at the gate',
        held.pos === 'ind_0', `ended on ${held.pos}`);
    ok('gate: and never on a junction, which has no tile to stand on',
        !held.onJunction && held.hasTile, JSON.stringify(held));

    // Now take the next turn. It must be the gate again, not a free roll.
    const retry = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const M  = await import('/src/ui/ModalManager.js');
        M.closeAllModals();
        state.gameState = 'ACKNOWLEDGE';
        GC.startPreRoll();
        await new Promise(r => setTimeout(r, 600));
        const ov = document.getElementById('gate-overlay');
        return {
            gs: state.gameState,
            gateUp: !!ov && getComputedStyle(ov).display !== 'none',
            rollBtn: (() => { const b = document.getElementById('gate-roll-btn'); return !!b && !b.disabled; })(),
        };
    });
    ok('gate: the next turn puts you back at the gate, as the card promised',
        retry.gateUp && retry.gs === 'GATE', JSON.stringify(retry));
    ok('gate: with a live roll button, so the retry is actually playable',
        retry.rollBtn, JSON.stringify(retry));

    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        state.gateOpen = true;
        GC.closeGate();
    });
    await page.waitForTimeout(600);

    // ---------------------------------------------------------------
    // 6. The duel must never be a dead end.
    //
    // Reported: "when I land on a duel, if I have zero coins I cannot do
    // anything." Every bet button was disabled and the modal has no close, with
    // gameState pinned at ACKNOWLEDGE — the one place on the board where being
    // broke stopped the game rather than costing you. Two halves to it: the
    // lander being broke (a stake on arrival fixes that) and the OPPONENT being
    // broke (no stake to the lander can fix that — it needs a way out).
    // ---------------------------------------------------------------
    const resetToRoll = () => page.evaluate(async () => {
        const M  = await import('/src/ui/ModalManager.js');
        const D  = await import('/src/core/Director.js');
        const R  = await import('/src/engine/Renderer.js');
        const SP = await import('/src/engine/SetPieces.js');
        const GC = await import('/src/core/GameController.js');
        D.reset(); R.getActiveAnims().length = 0; SP.clearSetPieces();
        R.endCinematic(); R.clearGateFocus(); M.closeAllModals();
        document.body.classList.remove('gate-scene');
        GC.startPreRoll();
    });

    // Drive a real landing and wait for the bet picker to be on screen.
    const runDuel = async (myCoins, oppCoins) => {
        await resetToRoll();
        await page.waitForTimeout(600);
        await page.evaluate(async ([mine, theirs]) => {
            const { state } = await import('/src/core/GameState.js');
            const GC = await import('/src/core/GameController.js');
            const R  = await import('/src/engine/Renderer.js');
            state.activePlayer = 0;
            // Clear the bounties first. Landing on a duel fires
            // _checkContract(p,'land_type','duel'), and if the live board
            // happens to be holding that card it pays out between setting the
            // coin count and the picker appearing — which made this assertion
            // read 14 on some runs and 3 on others. The stake is a DELTA; the
            // absolute total is not this probe's business.
            state.activeContracts = [];
            state.players[0].coins = mine;
            state.players[1].coins = theirs;
            window.__coinsBefore = mine;
            state.players[0].pos = 'r5'; state.players[0].mesh.position.copy(R.getPos('r5'));
            state.board['r5'] = { type: 'duel' };
            state.gameState = 'MOVING';
            R.snapCameraToActive();
            GC.resolveSpace(state.players[0]);
        }, [myCoins, oppCoins]);
        let seen = null;
        for (let i = 0; i < 60 && !seen; i++) {
            await page.waitForTimeout(250);
            seen = await page.evaluate(async () => {
                const m = document.getElementById('duel-modal');
                if (!m || getComputedStyle(m).display === 'none') return null;
                const { state } = await import('/src/core/GameState.js');
                const all = [...document.querySelectorAll('#duel-bet-options [data-bet]')];
                const out = document.getElementById('btn-duel-skip');
                return {
                    coins: state.players.map(p => p.coins),
                    gained: state.players[0].coins - window.__coinsBefore,
                    bets: all.length,
                    enabled: all.filter(b => !b.disabled).length,
                    exit: !!out && out.offsetParent !== null,
                    note: (document.getElementById('duel-note') || {}).innerText || ''
                };
            });
        }
        return seen;
    };

    // (a) Lander broke, opponent solvent — the reported case.
    const brokeLander = await runDuel(0, 10);
    ok('duel: landing on the ring while broke still opens the bet picker',
        !!brokeLander, brokeLander ? '' : 'duel modal never appeared');
    ok('duel: and hands the lander a stake to bet with',
        !!brokeLander && brokeLander.gained === 3,
        brokeLander ? `+${brokeLander.gained} coins on arrival` : 'no modal');
    ok('duel: so at least one bet is actually affordable',
        !!brokeLander && brokeLander.enabled > 0,
        brokeLander ? `${brokeLander.enabled}/${brokeLander.bets} enabled` : 'n/a');

    // (b) Both broke — no stake can create a wager, so there must be an exit.
    const bothBroke = await runDuel(0, 0);
    ok('duel: an unbettable duel offers a way out instead of a wall',
        !!bothBroke && bothBroke.exit && bothBroke.bets === 0,
        bothBroke ? `exit=${bothBroke.exit} bets=${bothBroke.bets} · "${bothBroke.note}"` : 'no modal');
    const escaped = await page.evaluate(async () => {
        const b = document.getElementById('btn-duel-skip');
        if (b) b.click();
        await new Promise(r => setTimeout(r, 2600));
        const { state } = await import('/src/core/GameState.js');
        const m = document.getElementById('duel-modal');
        return { open: !!m && getComputedStyle(m).display !== 'none', gs: state.gameState };
    });
    ok('duel: and taking it closes the modal and releases the turn',
        !!escaped && !escaped.open && escaped.gs !== 'ACKNOWLEDGE', JSON.stringify(escaped));

    await resetToRoll();
    await page.waitForTimeout(500);

    // ---------------------------------------------------------------
    // 7. Every set piece must leave the scene graph where it found it.
    // ---------------------------------------------------------------
    const leak = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const SP = await import('/src/engine/SetPieces.js');
        const R  = await import('/src/engine/Renderer.js');
        const count = () => { let n = 0; R.getScene().traverse(o => { if (o.isMesh) n++; }); return n; };
        const a = state.players[0], b = state.players[1];
        const at = a.mesh.position.clone();
        const base = count();
        const run = fn => new Promise(res => fn(res));
        await run(d => SP.magnetPull(a, b, 5, d));
        await run(d => SP.hqPayout(a, 15, d));
        await run(d => SP.mysteryUnbox(at, d));
        await run(d => SP.anchorSpring(at, d));
        await run(d => SP.duelFaceoff(a, b, d));
        SP.coinPop(at, true); SP.finePop(at, true, true);
        SP.trucePop(a.mesh.position.clone(), b.mesh.position.clone()); SP.shopGlow(at);
        await new Promise(r => setTimeout(r, 2400));
        SP.clearSetPieces();
        return { base, after: count() };
    });
    ok('set pieces: nine of them in a row leave the scene graph unchanged',
        leak.after === leak.base, `${leak.base} → ${leak.after} meshes`);

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));

    await browser.close();
    console.log('\nPASS:'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL:'); fail.length ? fail.forEach(f => console.log('  ✗ ' + f)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
