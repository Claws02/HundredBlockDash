// ============================================================
// TWO PERSISTENT READOUTS
//
//   1. At a fork: how far the roll still carries you, big enough to read.
//      A fork is a choice about which run of tiles to spend the REST of the
//      roll on, and that number was nowhere on screen — the player had to
//      remember the die and subtract the steps already walked, at the one
//      moment the game asks them to plan.
//   2. A shield you are still carrying. `_shielded` is a flag and the item
//      leaves the bag the instant it is used, so the bag looks empty and
//      nothing says the shield is up. Players re-bought shields they had.
//
// Both are chrome that sits over a live board, so both have to survive the
// tabletop half-turn and stay clear of the controls and the toast rail.
//
// usage: node readouts.js
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

// One helper both halves use: is this element on screen and not covered?
const RECT = `(id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    // An element inside a display:none ANCESTOR still reports its own computed
    // display, so the check above passes and the rect comes back all zeros.
    if (r.width === 0 && r.height === 0) return null;
    return { top: Math.round(r.top), bottom: Math.round(r.bottom),
             left: Math.round(r.left), right: Math.round(r.right),
             w: Math.round(r.width), h: Math.round(r.height) };
}`;

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
    // Tabletop, so the half-turn is exercised without a second run.
    await page.evaluate(() => window.__QA.startRun({ mode: 'tabletop', map: 'city_circuit' }));
    let ready = false;
    for (let i = 0; i < 400 && !ready; i++) {
        ready = await page.evaluate(() => window.__QA.snapshot().gameState === 'PRE_ROLL');
        if (ready) break;
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(140);
    }
    ok('boot: City match at the roll', ready);

    // ---------------------------------------------------------------
    // 1. The fork readout.
    // ---------------------------------------------------------------
    // Park one step short of a fork and roll 5. Nothing has been walked yet when
    // the choice comes up, so the roll still owes all 5 — the hop onto the
    // chosen road is the first of them, not a freebie before them.
    const fork = await page.evaluate(async (rectSrc) => {
        const rect = eval(rectSrc);
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        const G  = window.CITY_GRAPH_REF;
        // Find a node whose next hop is a junction.
        const before = Object.keys(G).find(id => !G[id].isJunction && (G[id].next || []).some(n => G[n] && G[n].isJunction));
        state.activePlayer = 0;
        const p = state.players[0];
        p.isBot = false;
        p.pos = before; p.mesh.position.copy(R.getPos(before));
        GC.moveThroughGraph(p, 5);
        for (let i = 0; i < 50; i++) {
            await new Promise(r => setTimeout(r, 200));
            const layer = document.getElementById('junction-layer');
            if (layer && getComputedStyle(layer).display !== 'none') break;
        }
        await new Promise(r => setTimeout(r, 400));
        return {
            from: before,
            steps: rect('junction-steps'),
            num: (document.getElementById('junction-steps-num') || {}).textContent,
            cap: (document.getElementById('junction-steps-cap') || {}).textContent,
            arrows: [...document.querySelectorAll('#junction-arrows .j-arrow')].map(a => {
                const r = a.getBoundingClientRect();
                return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
            }),
            mapBtn: rect('btn-junction-map'),
            banner: rect('junction-banner'),
            strip: rect('contracts-strip'),
            round: rect('round-counter'),
            H: window.innerHeight,
        };
    }, RECT);
    ok('fork: the readout is on screen while the choice is open',
        !!fork.steps, JSON.stringify(fork.steps));
    ok('fork: it says how many tiles the roll still owes',
        fork.num === '5' && /SPACES LEFT/.test(fork.cap),
        `rolled 5 one step from the fork → "${fork.num} ${fork.cap}"`);
    ok('fork: big enough to read at a glance',
        !!fork.steps && fork.steps.h >= 60, fork.steps ? `${fork.steps.h}px tall` : 'n/a');
    // The top of a City screen carries three rows of chrome: the round counter,
    // the bounty strip and the fork banner. A first placement cleared the banner
    // and came out half-hidden behind the bounty chips anyway.
    ok('fork: it clears every row of chrome above it',
        !!fork.steps && [fork.banner, fork.strip, fork.round]
            .filter(Boolean).every(r => fork.steps.top >= r.bottom - 1),
        `steps top ${fork.steps && fork.steps.top} vs banner ${fork.banner && fork.banner.bottom}, `
        + `strip ${fork.strip && fork.strip.bottom}, round ${fork.round && fork.round.bottom}`);
    ok('fork: and clear of every road arrow',
        fork.arrows.length > 0 && fork.arrows.every(a => a.top > fork.steps.bottom || a.bottom < fork.steps.top),
        `steps ${fork.steps.top}–${fork.steps.bottom} vs ${JSON.stringify(fork.arrows)}`);
    await page.screenshot({ path: path.join(__dirname, 'shot-fork-steps.png') });

    // Player 2's turn flips the whole board. The readout must flip with it.
    const forkP2 = await page.evaluate(async (rectSrc) => {
        const rect = eval(rectSrc);
        const { state } = await import('/src/core/GameState.js');
        const U = await import('/src/ui/UIManager.js');
        state.activePlayer = 1;
        U.applyOrientation();
        await new Promise(r => setTimeout(r, 250));
        const el = document.getElementById('junction-steps');
        return { rect: rect('junction-steps'), transform: getComputedStyle(el).transform,
                 flipped: document.body.classList.contains('tabletop-p2-turn'), H: window.innerHeight };
    }, RECT);
    ok('fork: on Player 2\'s turn the readout turns to face them',
        forkP2.flipped && /matrix\(-1/.test(forkP2.transform), forkP2.transform);
    ok('fork: and moves to their half of the screen',
        forkP2.rect && forkP2.rect.top > forkP2.H / 2,
        `top ${forkP2.rect && forkP2.rect.top} of ${forkP2.H}`);
    await page.screenshot({ path: path.join(__dirname, 'shot-fork-steps-p2.png') });

    // Choosing a road takes it away again.
    const forkGone = await page.evaluate(async (rectSrc) => {
        const rect = eval(rectSrc);
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        state.activePlayer = 0;
        const btn = document.querySelector('#junction-arrows .j-arrow:not(.j-locked)');
        GC.onBranchChosen(btn.dataset.node);
        await new Promise(r => setTimeout(r, 500));
        return rect('junction-steps');
    }, RECT);
    ok('fork: it goes away when the road is chosen', forkGone === null, JSON.stringify(forkGone));

    // The primer explains the fork the first time a match ever shows one — that
    // fork can arrive on turn one, before any ordinary turn has been taken. It
    // must not cover the readout, the arrows or the scout button.
    const primer = await page.evaluate(async (rectSrc) => {
        const rect = eval(rectSrc);
        const { state } = await import('/src/core/GameState.js');
        const U = await import('/src/ui/UIManager.js');
        const { BRANCH_OPTIONS } = await import('/src/config/BoardGraph.js');
        state.activePlayer = 0;
        U.applyOrientation();
        U.resetForkPrimer();
        U.showJunctionArrows('bp_b', 'r5', BRANCH_OPTIONS.bp_b, 3);
        await new Promise(r => setTimeout(r, 350));
        const first = { primer: rect('junction-primer'), steps: rect('junction-steps'),
                        scout: rect('btn-junction-map'),
                        arrows: [...document.querySelectorAll('#junction-arrows .j-arrow')].map(a => {
                            const r = a.getBoundingClientRect();
                            return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
                        }),
                        text: (document.getElementById('junction-primer') || {}).textContent || '' };
        U.hideJunctionArrows();
        await new Promise(r => setTimeout(r, 200));
        U.showJunctionArrows('bp_c', 'r10', BRANCH_OPTIONS.bp_c, 2);
        await new Promise(r => setTimeout(r, 300));
        const second = rect('junction-primer');
        U.hideJunctionArrows();
        return { first, second };
    }, RECT);
    ok('fork: the first fork of a match explains itself',
        !!primer.first.primer && /junction/i.test(primer.first.text), primer.first.text);
    ok('fork: and only the first — it does not nag at every fork after',
        primer.second === null, JSON.stringify(primer.second));
    const pr = primer.first;
    ok('fork: the primer clears the readout, the arrows and the scout button',
        !!pr.primer && pr.primer.top > pr.steps.bottom
        && (!pr.scout || pr.primer.bottom <= pr.scout.top + 1)
        && pr.arrows.every(a => a.bottom < pr.primer.top || a.top > pr.primer.bottom),
        `primer ${JSON.stringify(pr.primer)} · steps ${JSON.stringify(pr.steps)} · scout ${JSON.stringify(pr.scout)}`);

    // ---------------------------------------------------------------
    // 2. The shield marker.
    // ---------------------------------------------------------------
    const reset = () => page.evaluate(async () => {
        const M  = await import('/src/ui/ModalManager.js');
        const D  = await import('/src/core/Director.js');
        const R  = await import('/src/engine/Renderer.js');
        const SP = await import('/src/engine/SetPieces.js');
        const GC = await import('/src/core/GameController.js');
        const { state } = await import('/src/core/GameState.js');
        D.reset(); R.getActiveAnims().length = 0; SP.clearSetPieces();
        R.endCinematic(); M.closeAllModals();
        state.activePlayer = 0;
        state.players.forEach(p => { p._shielded = false; p.allies = []; });
        GC.startPreRoll();
    });
    await reset();
    await page.waitForTimeout(500);

    const shield = await page.evaluate(async (rectSrc) => {
        const rect = eval(rectSrc);
        const { state } = await import('/src/core/GameState.js');
        const U  = await import('/src/ui/UIManager.js');
        const before = rect('shield-marker');
        state.players[0]._shielded = true;
        U.updateUI();
        await new Promise(r => setTimeout(r, 200));
        const on = rect('shield-marker');
        return {
            before, on,
            text: (document.getElementById('shield-marker-tx') || {}).textContent,
            W: window.innerWidth, H: window.innerHeight,
            roll: rect('p1-actions'), toast: rect('toast-box'),
        };
    }, RECT);
    ok('shield: nothing is shown when no shield is up', shield.before === null);
    ok('shield: raising one puts a marker on screen', !!shield.on, JSON.stringify(shield.on));
    ok('shield: it is in the bottom-left corner',
        !!shield.on && shield.on.left < shield.W * 0.35 && shield.on.bottom > shield.H * 0.6,
        `${JSON.stringify(shield.on)} of ${shield.W}x${shield.H}`);
    ok('shield: it says what it is',
        /shield/i.test(shield.text || ''), shield.text);
    ok('shield: clear of the action buttons, which own the right half',
        !shield.roll || shield.on.right < shield.roll.left,
        `marker right ${shield.on.right} vs buttons left ${shield.roll && shield.roll.left}`);
    await page.screenshot({ path: path.join(__dirname, 'shot-shield-marker.png') });

    // Spending it takes the marker down immediately, not at the next HUD paint.
    const spent = await page.evaluate(async (rectSrc) => {
        const rect = eval(rectSrc);
        const { state } = await import('/src/core/GameState.js');
        const EC = await import('/src/core/Economy.js');
        const p = state.players[0];
        p.coins = 30;
        const lost = EC.loseCoins(p, 8);
        return { lost, coins: p.coins, flag: p._shielded, marker: rect('shield-marker') };
    }, RECT);
    ok('shield: it really blocks the hit', spent.lost === 0 && spent.coins === 30, JSON.stringify(spent));
    ok('shield: and the marker comes down the moment it is spent',
        spent.marker === null && spent.flag === false, JSON.stringify(spent));

    // A Bodyguard is the same idea with a count, and gets the same badge.
    const bg = await page.evaluate(async (rectSrc) => {
        const rect = eval(rectSrc);
        const { state } = await import('/src/core/GameState.js');
        const U = await import('/src/ui/UIManager.js');
        state.players[0].allies = [{ type: 'bodyguard', turnsRemaining: 3, shieldCharges: 2, mesh: null }];
        U.updateUI();
        await new Promise(r => setTimeout(r, 150));
        return { marker: rect('shield-marker'),
                 text: (document.getElementById('shield-marker-tx') || {}).textContent };
    }, RECT);
    ok('shield: a Bodyguard shows the same badge, with its charges',
        !!bg.marker && /2/.test(bg.text || ''), bg.text);

    // It lives outside #ui-layer, so it has to respect the HUD being hidden.
    const hidden = await page.evaluate(async (rectSrc) => {
        const rect = eval(rectSrc);
        const U = await import('/src/ui/UIManager.js');
        document.getElementById('ui-layer').style.display = 'none';
        U.updateShieldMarker();
        const during = rect('shield-marker');
        document.getElementById('ui-layer').style.display = 'block';
        U.updateShieldMarker();
        return { during, after: rect('shield-marker') };
    }, RECT);
    ok('shield: it hides with the HUD, so it cannot float over a minigame',
        hidden.during === null && !!hidden.after, JSON.stringify(hidden));

    // ---------------------------------------------------------------
    // 3. The round counter, and the last round announcing itself.
    // ---------------------------------------------------------------
    // state.currentRound counts rounds COMPLETED, so printing it raw made the
    // opening round read "ROUND 0/12" and the final one "ROUND 11/12" — a round
    // behind the game the whole way through, and a match that never showed its
    // own last round as the last one.
    const counter = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const U = await import('/src/ui/UIManager.js');
        const out = [];
        const total = 12;
        state.cityRounds = total;
        [0, 1, 5, total - 1, total].forEach(c => {
            state.currentRound = c;
            U.updateRoundCounter(c, total);
            out.push({ completed: c, shown: document.getElementById('round-counter').textContent });
        });
        return { out, fn: [U.displayRound(0, 12), U.displayRound(11, 12), U.displayRound(12, 12)] };
    });
    ok('rounds: the opening round is round 1, not round 0',
        /ROUND 1\/12/.test(counter.out[0].shown), counter.out[0].shown);
    ok('rounds: the final round reads N of N',
        /ROUND 12\/12/.test(counter.out[3].shown), counter.out[3].shown);
    ok('rounds: and it never runs past the total',
        /ROUND 12\/12/.test(counter.out[4].shown) && counter.fn[2] === 12,
        counter.out[4].shown);

    const finalBanner = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const U  = await import('/src/ui/UIManager.js');
        const D  = await import('/src/core/Director.js');
        const M  = await import('/src/ui/ModalManager.js');
        const R  = await import('/src/engine/Renderer.js');
        const { SCENE } = await import('/src/config/SceneTiming.js');
        D.reset(); R.getActiveAnims().length = 0; M.closeAllModals();
        U.hideFinalRoundBanner();
        document.getElementById('ally-arrival').style.display = 'none';
        state.allyOnMap = null; R.removeAllyMarker();
        state.players.forEach(p => { p.allies = []; p.isBot = false; });

        // Not the last round: nothing should be announced.
        state.cityRounds = 6; state.currentRound = 3;
        state.activePlayer = 0;
        GC.startPreRoll();
        await new Promise(r => setTimeout(r, 400));
        const midMatch = U.finalRoundBannerUp();
        U.hideFinalRoundBanner();

        // The last round: currentRound counts COMPLETED, so 5 of 6 is the 6th.
        state.currentRound = 5;
        GC.startPreRoll();
        await new Promise(r => setTimeout(r, 350));
        const up = U.finalRoundBannerUp();
        const text = (document.getElementById('final-round') || {}).innerText || '';
        const gs = state.gameState;

        // It must hold the beat, then hand the turn over on its own.
        // Sample until it goes down, and report WHEN — a guessed wait told us it
        // was early without saying by how much.
        const t0 = performance.now();
        let downAt = null;
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 100));
            if (!U.finalRoundBannerUp()) { downAt = Math.round(performance.now() - t0) + 350; break; }
        }
        const stillUpJustBefore = downAt !== null && downAt >= SCENE.FINAL_ROUND - 400;
        await new Promise(r => setTimeout(r, 700));
        const after = { up: U.finalRoundBannerUp(), gs: state.gameState };

        // And it does not announce twice.
        GC.startPreRoll();
        await new Promise(r => setTimeout(r, 350));
        const again = U.finalRoundBannerUp();
        U.hideFinalRoundBanner();
        return { midMatch, up, text: text.replace(/\s+/g, ' ').trim(), gs,
                 stillUpJustBefore, downAt, after, again, floor: SCENE.FINAL_ROUND };
    });
    ok('final round: nothing is announced mid-match',
        !finalBanner.midMatch);
    ok('final round: the last round announces itself',
        finalBanner.up && /FINAL ROUND/i.test(finalBanner.text), finalBanner.text.slice(0, 90));
    ok('final round: it names the round it is — N of N',
        /ROUND 6 OF 6/i.test(finalBanner.text), finalBanner.text.slice(0, 60));
    ok('final round: nothing can be rolled underneath it',
        finalBanner.gs !== 'PRE_ROLL', `gameState was ${finalBanner.gs}`);
    ok('final round: it holds the full three seconds',
        finalBanner.stillUpJustBefore && finalBanner.floor === 3000,
        `came down at ${finalBanner.downAt}ms, floor ${finalBanner.floor}ms`);
    ok('final round: then hands the turn over by itself',
        !finalBanner.after.up && finalBanner.after.gs === 'PRE_ROLL',
        JSON.stringify(finalBanner.after));
    ok('final round: and it only ever fires once',
        !finalBanner.again);
    // Raise it again for the picture — by the time the assertions above have
    // run it has legitimately come down.
    await page.evaluate(async () => {
        const U = await import('/src/ui/UIManager.js');
        const { state } = await import('/src/core/GameState.js');
        state.activePlayer = 0;
        U.updateRoundCounter(5, 6);
        U.showFinalRoundBanner(6);
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(__dirname, 'shot-final-round.png') });
    await page.evaluate(async () => (await import('/src/ui/UIManager.js')).hideFinalRoundBanner());

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));

    await browser.close();
    console.log('\nPASS:'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL:'); fail.length ? fail.forEach(f => console.log('  ✗ ' + f)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
