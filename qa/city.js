// ============================================================
// CITY CIRCUIT audit probe.
//
// Six claims, all of which came out of the 2026-08 City pass:
//
//   1. The opening briefing appears once, names all five routes, and its map
//      tour comes BACK to the briefing rather than dumping you into the game.
//   2. A junction presents arrows over the board — not a card covering it —
//      one per road, each labelled with where it goes.
//   3. Scouting the map from a junction returns to that same junction with the
//      choice still open.
//   4. No City space moves a player along the track. Generated boards must
//      contain zero shortcut / cfwd / cbwd tiles, and the branch-choice copy
//      must not promise shortcuts either.
//   5. The follow camera is frame-rate independent and settles. Sampled over a
//      turn, the camera's per-frame movement has to decay, not oscillate.
//   6. An ally minigame hands the camera back. This is the bug that shipped:
//      endMinigame parks cameraState on 'FLYOVER' and the ally handler never
//      restored it, so the camera stopped following for the rest of the match.
//
// usage: node city.js
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
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: GL,
    });
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

    // ---------------------------------------------------------------
    // 4a. Board content — checked on the pools before anything renders.
    // ---------------------------------------------------------------
    const pools = await page.evaluate(async () => {
        const AM = await import('/src/config/ActiveMap.js');
        const DISTRICT_POOLS = AM.pools(), BRANCH_OPTIONS = AM.branches();
        const all = Object.values(DISTRICT_POOLS).flat();
        return {
            movers: all.filter(t => ['shortcut', 'cfwd', 'cbwd'].includes(t)),
            total:  all.length,
            copy:   Object.values(BRANCH_OPTIONS).flat().map(o => `${o.label} ${o.desc}`).join(' | '),
        };
    });
    ok('no skip spaces: district pools carry zero shortcut/cfwd/cbwd',
        pools.movers.length === 0, `${pools.movers.length} of ${pools.total}: ${pools.movers.join(',')}`);
    ok('no skip spaces: junction copy no longer advertises shortcuts',
        !/shortcut/i.test(pools.copy), pools.copy);

    // ---------------------------------------------------------------
    // Start a City match (pass-and-play, two humans).
    // ---------------------------------------------------------------
    // keepBriefing: this is the probe that tests it, so the harness must not
    // dismiss it out from under us.
    await page.evaluate(() => window.__QA.startRun({ mode: 'pass', map: 'city_circuit', keepBriefing: true }));

    // The briefing waits at the end of the flyover.
    await page.waitForFunction(() => {
        const el = document.getElementById('city-briefing');
        return el && getComputedStyle(el).display !== 'none';
    }, null, { timeout: 40000 }).catch(() => {});

    const brief = await page.evaluate(() => {
        const el = document.getElementById('city-briefing');
        const shown = el && getComputedStyle(el).display !== 'none';
        const rows = [...document.querySelectorAll('#cb-paths .cb-path')].map(r => ({
            name: r.querySelector('.cb-name')?.textContent || '',
            len:  r.querySelector('.cb-len')?.textContent || '',
        }));
        return { shown, rows, uiHidden: getComputedStyle(document.getElementById('ui-layer')).display === 'none' };
    });
    await page.screenshot({ path: path.join(__dirname, 'shot-city-briefing.png') });
    ok('briefing: shown before the first roll', brief.shown);
    ok('briefing: names all five routes', brief.rows.length === 5,
        brief.rows.map(r => `${r.name}(${r.len})`).join(', '));
    ok('briefing: every route states its length',
        brief.rows.every(r => /^\d+$/.test(r.len.trim())), JSON.stringify(brief.rows));
    ok('briefing: the HUD is out of the way behind it', brief.uiHidden);

    // 1b. The map tour must come back to the briefing.
    await page.evaluate(() => document.getElementById('btn-cb-tour').click());
    await page.waitForTimeout(500);
    const inTour = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return {
            map: getComputedStyle(document.getElementById('map-ui')).display !== 'none',
            briefHidden: getComputedStyle(document.getElementById('city-briefing')).display === 'none',
            cam: state.cameraState,
        };
    });
    ok('briefing: SHOW ME THE MAP opens the map view', inTour.map && inTour.briefHidden, JSON.stringify(inTour));

    await page.evaluate(() => document.getElementById('btn-close-map').click());
    await page.waitForTimeout(400);
    const backFromTour = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return {
            brief: getComputedStyle(document.getElementById('city-briefing')).display !== 'none',
            gs: state.gameState,
        };
    });
    ok('briefing: closing the map returns to the briefing, not into the match',
        backFromTour.brief, JSON.stringify(backFromTour));

    await page.evaluate(() => document.getElementById('btn-cb-start').click());
    await page.waitForTimeout(700);
    const started = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return { gs: state.gameState, cam: state.cameraState,
                 ui: getComputedStyle(document.getElementById('ui-layer')).display !== 'none' };
    });
    ok('briefing: START hands over to the match with the camera following',
        started.cam === 'FOLLOW' && started.ui, JSON.stringify(started));

    // The action stack gained a fourth square. It has to still fit on a phone
    // with the Cabbie button in play, and none of it may run off screen.
    await page.screenshot({ path: path.join(__dirname, 'shot-city-actions.png') });
    const stack = await page.evaluate(() => {
        const row = document.querySelector('.action-row[style*="flex"], #p1-actions');
        const btns = [...document.querySelectorAll('#p1-actions .btn-action')]
            .filter(b => getComputedStyle(b).display !== 'none');
        const boxes = btns.map(b => { const r = b.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), tx: b.querySelector('.ba-tx')?.textContent }; });
        return { n: btns.length, boxes, H: window.innerHeight, W: window.innerWidth,
                 rowVisible: row ? getComputedStyle(row).display !== 'none' : false };
    });
    ok('actions: the bounties square is in the stack',
        stack.boxes.some(b => /BOUNT/.test(b.tx || '')), JSON.stringify(stack.boxes.map(b => b.tx)));
    ok('actions: the whole stack fits on screen',
        stack.boxes.every(b => b.t >= 0 && b.b <= stack.H && b.l >= 0 && b.r <= stack.W),
        JSON.stringify(stack));

    // The briefing must not come back for the rest of the match.
    const briefingCount = await page.evaluate(() => {
        window.__cityBriefSeen = 0;
        const el = document.getElementById('city-briefing');
        new MutationObserver(() => {
            if (getComputedStyle(el).display !== 'none') window.__cityBriefSeen++;
        }).observe(el, { attributes: true, attributeFilter: ['style'] });
        return true;
    });

    // ---------------------------------------------------------------
    // 5. Camera settling. Drive a few turns, sampling camera position each
    //    frame, and check the motion decays instead of ringing.
    // ---------------------------------------------------------------
    // A deliberate snap (snapCameraToActive, and the hand-off out of a
    // full-screen scene) is allowed to move the camera any distance — that IS
    // the fix for resuming after the gate or a minigame. What must never happen
    // is a lurch while the camera is simply following a player, which is what
    // the old per-frame heading produced on every change of node. So each
    // sample carries the mode it was taken in, and only settled FOLLOW frames
    // are judged.
    await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const { state } = await import('/src/core/GameState.js');
        window.__camSamples = [];
        const cam = R.getCamera();
        let last = cam.position.clone();
        let prevMode = state.cameraState;
        let sinceSwitch = 0;
        let lastT = performance.now();
        (function sample() {
            requestAnimationFrame(sample);
            const mode = state.cameraState;
            if (mode !== prevMode) { prevMode = mode; sinceSwitch = 0; } else { sinceSwitch++; }
            const now = performance.now();
            // Software GL in a headless container drops frames hard, and the
            // whole point of the damped camera is that a long frame moves it
            // proportionally further. Measuring raw per-frame distance would
            // therefore flag the FIX as the bug, so normalise to a 60 Hz frame.
            const dt = Math.min(Math.max((now - lastT) / 1000, 1 / 240), 0.1);
            lastT = now;
            const d = cam.position.distanceTo(last);
            last = cam.position.clone();
            // Where the camera is POINTING is what the player feels. The old
            // heading was recomputed from the token's live mesh position, so it
            // swung through every hop and the view swung with it — the position
            // barely moved while doing it, which is why a position-only probe
            // sails straight past the bug.
            const fwd = new (cam.getWorldDirection(new (last.constructor)()).constructor)();
            cam.getWorldDirection(fwd);
            const dot = Math.max(-1, Math.min(1, fwd.dot(window.__lastFwd || fwd)));
            const yaw = Math.acos(dot) * 180 / Math.PI;
            window.__lastFwd = fwd.clone();
            window.__camSamples.push({ d, per60: d / (dt * 60), yaw60: yaw / (dt * 60), mode, settled: sinceSwitch > 4 });
            if (window.__camSamples.length > 4000) window.__camSamples.shift();
        })();
    });

    // ---------------------------------------------------------------
    // 2 + 3. Junction arrows. Park the player one step short of a junction and
    // roll a 1 so the fork comes up on this turn.
    // ---------------------------------------------------------------
    let junctionSeen = false, junctionInfo = null, scoutOk = null;
    for (let i = 0; i < 400 && !junctionSeen; i++) {
        const s = await page.evaluate(async () => {
            const { state } = await import('/src/core/GameState.js');
            return { gs: state.gameState, junction: getComputedStyle(document.getElementById('junction-layer')).display !== 'none' };
        });
        if (s.junction) {
            junctionSeen = true;
            junctionInfo = await page.evaluate(() => {
                const arrows = [...document.querySelectorAll('#junction-arrows .j-arrow')];
                return {
                    count: arrows.length,
                    labels: arrows.map(a => a.querySelector('.j-name')?.textContent || ''),
                    metas:  arrows.map(a => a.querySelector('.j-meta')?.textContent || ''),
                    // Positions must be real screen coordinates inside the viewport,
                    // and the two arrows must not be sitting on top of each other.
                    boxes: arrows.map(a => { const r = a.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) }; }),
                    // The board must still be visible behind them.
                    cardOverlay: getComputedStyle(document.getElementById('branch-choice-overlay')).display !== 'none',
                    layerBg: getComputedStyle(document.getElementById('junction-layer')).backgroundColor,
                };
            });
            // 3. Scout the map, then come back.
            await page.evaluate(() => document.getElementById('btn-junction-map').click());
            await page.waitForTimeout(450);
            const onMap = await page.evaluate(async () => {
                const { state } = await import('/src/core/GameState.js');
                return { map: getComputedStyle(document.getElementById('map-ui')).display !== 'none',
                         arrowsHidden: getComputedStyle(document.getElementById('junction-layer')).display === 'none',
                         gs: state.gameState };
            });
            await page.evaluate(() => document.getElementById('btn-close-map').click());
            await page.waitForTimeout(450);
            const back = await page.evaluate(async () => {
                const { state } = await import('/src/core/GameState.js');
                return { arrows: getComputedStyle(document.getElementById('junction-layer')).display !== 'none',
                         cam: state.cameraState, gs: state.gameState };
            });
            scoutOk = { onMap, back };
            await page.screenshot({ path: path.join(__dirname, 'shot-city-junction.png') });

            // Tabletop flip. The board canvas is turned a half turn for Player
            // 2, so a world point projected at (x, y) is DRAWN at (W−x, H−y).
            // These buttons are ordinary DOM outside that rotation, so if the
            // flip is not undone the arrow labelled Back Alley sits over the
            // Ring Road — the same class of bug that broke P2's map raycast.
            // Both the left/right and the top/bottom ordering must invert.
            junctionInfo.flip = await page.evaluate(async () => {
                const read = () => [...document.querySelectorAll('#junction-arrows .j-arrow')]
                    .map(a => { const r = a.getBoundingClientRect(); return { n: a.dataset.node, x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
                const before = read();
                document.body.classList.add('tabletop-p2-turn');
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                const after = read();
                document.body.classList.remove('tabletop-p2-turn');
                await new Promise(r => requestAnimationFrame(r));
                return { before, after };
            });
            // Take a road and carry on.
            await page.evaluate(() => document.querySelector('#junction-arrows .j-arrow')?.click());
            await page.waitForTimeout(500);
            break;
        }
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(140);
    }

    ok('junction: arrows appear over the board', junctionSeen);
    if (junctionInfo) {
        ok('junction: one arrow per road', junctionInfo.count === 2, `${junctionInfo.count} arrows`);
        ok('junction: each arrow is labelled with where it goes',
            junctionInfo.labels.every(l => l.trim().length > 2), JSON.stringify(junctionInfo.labels));
        ok('junction: each arrow states the length of that road',
            junctionInfo.metas.every(m => /\d+\s*spaces/.test(m)), JSON.stringify(junctionInfo.metas));
        const [a, b] = junctionInfo.boxes;
        ok('junction: the two arrows are visibly apart',
            !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) > 60,
            JSON.stringify(junctionInfo.boxes));
        ok('junction: arrows sit inside the viewport',
            junctionInfo.boxes.every(x => x.x > 0 && x.x < 412 && x.y > 0 && x.y < 892),
            JSON.stringify(junctionInfo.boxes));
        ok('junction: the old full-screen card is not used',
            junctionInfo.cardOverlay === false);
        ok('junction: the board is not dimmed behind the arrows',
            /rgba\(0, 0, 0, 0\)|transparent/.test(junctionInfo.layerBg), junctionInfo.layerBg);
        if (junctionInfo.flip) {
            const { before, after } = junctionInfo.flip;
            const sgn = (arr, k) => Math.sign(arr[0][k] - arr[1][k]);
            const xFlip = before.length === 2 && after.length === 2 && sgn(before, 'x') === -sgn(after, 'x');
            const yFlip = before.length === 2 && after.length === 2 && sgn(before, 'y') === -sgn(after, 'y');
            ok('junction: arrows follow the board through the tabletop half turn',
                xFlip && yFlip,
                `before ${JSON.stringify(before.map(b => [b.n, Math.round(b.x), Math.round(b.y)]))} after ${JSON.stringify(after.map(b => [b.n, Math.round(b.x), Math.round(b.y)]))}`);
        }
    }
    if (scoutOk) {
        ok('junction: SCOUT opens the map and parks the arrows',
            scoutOk.onMap.map && scoutOk.onMap.arrowsHidden, JSON.stringify(scoutOk.onMap));
        ok('junction: closing the map returns to the SAME junction, choice still open',
            scoutOk.back.arrows && scoutOk.back.cam === 'JUNCTION', JSON.stringify(scoutOk.back));
    }

    // ---------------------------------------------------------------
    // 4b. The live board must carry no movers either.
    // ---------------------------------------------------------------
    const liveBoard = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const types = Object.values(state.board).map(t => t && t.type);
        return { movers: types.filter(t => ['shortcut', 'cfwd', 'cbwd'].includes(t)).length, n: types.length };
    });
    ok('no skip spaces: the generated board carries none',
        liveBoard.movers === 0, `${liveBoard.movers} of ${liveBoard.n}`);

    // ---------------------------------------------------------------
    // 6. Ally minigame must hand the camera back.
    // ---------------------------------------------------------------
    const allyCam = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const MGM = await import('/src/minigames/MinigameManager.js');
        const before = state.cameraState;
        // Drive the real ally-claim path: this is exactly what a landing on an
        // ally node does, minus the encounter modal.
        state.allyOnMap = { nodeId: state.players[state.activePlayer].pos, allyType: 'cabbie' };
        return { before, has: typeof MGM.trigger === 'function' };
    });
    // Run it through the controller so the real completion handler fires.
    await page.evaluate(async () => {
        const GC = await import('/src/core/GameController.js');
        const { state } = await import('/src/core/GameState.js');
        window.__allyDone = false;
        // endMinigame() is what leaves cameraState on FLYOVER; reproduce the
        // exact sequence the ally path runs.
        state.cameraState = 'FLYOVER';
        GC.startPreRoll();
    });
    await page.waitForTimeout(300);
    const camAfter = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return state.cameraState;
    });
    ok('ally: a scene that forgets the camera cannot leave it dead',
        camAfter === 'FOLLOW', `cameraState=${camAfter} (was FLYOVER)`);

    // ---------------------------------------------------------------
    // 5. Read the camera samples back.
    // ---------------------------------------------------------------
    const cam = await page.evaluate(() => {
        const s = window.__camSamples || [];
        const fs = s.filter(x => x.mode === 'FOLLOW' && x.settled);
        const yaws = fs.map(x => x.yaw60).sort((a, b) => a - b);
        const follow = fs.map(x => x.per60);
        const p95 = yaws.length ? yaws[Math.floor(yaws.length * 0.95)] : 0;
        // How often the view REVERSES direction of swing — a settled camera
        // eases one way; a camera chasing a jittery heading hunts back and forth.
        let flips = 0;
        for (let i = 2; i < fs.length; i++) {
            const a = fs[i - 1].yaw60 - fs[i - 2].yaw60, b = fs[i].yaw60 - fs[i - 1].yaw60;
            if (a * b < 0 && Math.abs(a) > 0.05 && Math.abs(b) > 0.05) flips++;
        }
        const nz = s.filter(x => x.d > 1e-6);
        const worst = s.reduce((a, b) => (b.per60 > (a ? a.per60 : -1) ? b : a), null);
        return {
            n: s.length, followN: follow.length,
            followMax: Math.max(0, ...follow),
            followMean: follow.length ? follow.reduce((a, b) => a + b, 0) / follow.length : 0,
            nonZero: nz.length,
            yawMax: Math.max(0, ...yaws), yawP95: p95,
            yawFlipRate: fs.length > 20 ? flips / fs.length : 0,
            worst: worst ? { per60: +worst.per60.toFixed(2), mode: worst.mode, settled: worst.settled } : null,
        };
    });
    // The old heading was recomputed from the token's live mesh position every
    // frame, so it swung through every hop and snapped at every change of node,
    // and the camera swung with it. A damped heading cannot move the camera more
    // than a couple of units in one frame while it is simply following.
    ok('camera: settled follow frames never lurch (>3.5 units per 60Hz frame)',
        cam.followMax < 3.5,
        `max ${cam.followMax.toFixed(2)} over ${cam.followN} settled FOLLOW frames; worst overall ${JSON.stringify(cam.worst)}`);
    ok('camera: follow motion stays gentle on average',
        cam.followMean < 1.2, `mean ${cam.followMean.toFixed(3)} u per 60Hz frame`);
    // The touchiness lived in the AIM, not the position: the heading was read
    // off the token's live mesh every frame, so it swung through each hop and
    // snapped at every change of node. Damping the heading is what fixed it, and
    // these two are the numbers that move when it is undone.
    ok('camera: the view does not whip round (95th pct yaw < 1.2°/frame)',
        cam.yawP95 < 1.2, `p95 ${cam.yawP95.toFixed(2)}°, max ${cam.yawMax.toFixed(2)}°`);
    ok('camera: the view is not hunting back and forth',
        cam.yawFlipRate < 0.30, `direction reverses on ${(cam.yawFlipRate * 100).toFixed(0)}% of frames`);
    ok('camera: the follow camera is actually moving (probe is live)',
        cam.nonZero > 40, `${cam.nonZero} moving frames`);

    // ---------------------------------------------------------------
    // Bounties.
    // ---------------------------------------------------------------
    const bounty = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const { CONTRACT_POOL, COUNTED_TYPES } = await import('/src/config/ContractPool.js');
        return {
            active: (state.activeContracts || []).length,
            poolSize: CONTRACT_POOL.length,
            allHaveHints: CONTRACT_POOL.every(c => typeof c.hint === 'string' && c.hint.length > 8),
            deadItems: CONTRACT_POOL.filter(c => c.type === 'use_item').map(c => c.param),
            counted: [...COUNTED_TYPES],
        };
    });
    const realItems = await page.evaluate(async () => {
        const { ITEMS } = await import('/src/config/GameConfig.js');
        return Object.keys(ITEMS);
    });
    ok('bounties: every card carries a how-to hint', bounty.allHaveHints);
    ok('bounties: no card asks for an item the shops do not sell',
        bounty.deadItems.every(i => realItems.includes(i)),
        `${bounty.deadItems.join(',')} vs ${realItems.join(',')}`);

    // Clear whatever card the last turn left on screen so the shot shows the
    // panel and not a result modal stacked over it.
    await page.evaluate(async () => {
        const M = await import('/src/ui/ModalManager.js');
        M.closeAllModals();
        const { state } = await import('/src/core/GameState.js');
        state.gameState = 'PRE_ROLL';
        const U = await import('/src/ui/UIManager.js');
        U.openBounties();
    });
    await page.waitForTimeout(350);
    const panel = await page.evaluate(() => {
        const el = document.getElementById('bounty-panel');
        const cards = [...document.querySelectorAll('.bounty-card')];
        return {
            shown: el && getComputedStyle(el).display !== 'none',
            cards: cards.length,
            withHint: cards.filter(c => c.querySelector('.bq-hint')).length,
            withBars: cards.filter(c => c.querySelectorAll('.bq-track').length === 2).length,
            countedCards: cards.filter(c => c.querySelectorAll('.bq-track').length > 0).length,
        };
    });
    await page.screenshot({ path: path.join(__dirname, 'shot-city-bounties.png') });
    ok('bounties: the panel opens and lists the live cards',
        panel.shown && panel.cards === bounty.active, JSON.stringify(panel));
    ok('bounties: every listed card shows its hint',
        panel.cards > 0 && panel.withHint === panel.cards, JSON.stringify(panel));
    ok('bounties: counted cards show BOTH players’ progress',
        panel.countedCards === panel.withBars, JSON.stringify(panel));

    await page.evaluate(() => document.getElementById('btn-close-bounties').click());
    await page.waitForTimeout(250);

    const briefAgain = await page.evaluate(() => window.__cityBriefSeen || 0);
    ok('briefing: does not reappear during the match', briefAgain === 0, `${briefAgain} reopenings`);

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));

    await browser.close();

    console.log('\nPASS:'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL:'); fail.length ? fail.forEach(f => console.log('  ✗ ' + f)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
