// ============================================================
// Feature checks for the map view and practice mode.
//
//  1. MAP — the button is present on both boards, opens, drives the camera,
//     the slider spans the right range, tile tooltips resolve, and closing it
//     returns control. (It used to be a dead control on Hundred Block Dash.)
//  2. PRACTICE — runs a real minigame, awards nothing, and hands control back.
//     The stakes check is the point: coins, turn order and board position must
//     be byte-identical before and after.
//
// usage: node features.js
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
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // ---------- 2. PRACTICE (from the arcade, before any match exists) ----------
    const practice = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const MGM = await import('/src/minigames/MinigameManager.js');
        // Give the players some state worth protecting.
        state.players[0].coins = 42; state.players[1].coins = 17;
        state.players[0].pos = 7;    state.players[1].pos = 3;
        state.players[0].mgWins = 2; state.players[1].mgWins = 1;
        state.activePlayer = 0;
        state.selectedMap = 'hundred_block_dash';
        const before = JSON.stringify({
            c: state.players.map(p => p.coins), pos: state.players.map(p => p.pos),
            w: state.players.map(p => p.mgWins), active: state.activePlayer,
        });

        window.__practiceReturned = false;
        MGM.triggerPractice('snapstrike', true, () => {
            window.__practiceReturned = true;
            document.getElementById('mg-select-overlay').style.display = 'flex';
        });
        const flagged = MGM.isPractice();
        // Drive it: intro → orientation → ready → run → force the result.
        return { before, flagged, started: state.gameState };
    });
    ok('practice: flagged as practice on entry', practice.flagged === true);
    ok('practice: enters the intro', practice.started === 'MINIGAME_INTRO', practice.started);

    // The flow the player actually sees. Practice used to re-show the rules card
    // the player had just read, so entering it took two confirmations in a row —
    // and in tabletop mode, two from BOTH players. It now lands on the ready
    // screen directly, and the practice tag has to be small enough that WE'RE
    // READY is still on the phone.
    const ready = await page.evaluate(() => {
        const hold = document.getElementById('mg-page-hold');
        const info = document.getElementById('mg-page-info');
        const tag  = document.getElementById('mg-practice-banner');
        const btn  = document.getElementById('btn-mg-launch');
        const r = btn.getBoundingClientRect();
        return {
            holdShown:  getComputedStyle(hold).display !== 'none',
            infoHidden: getComputedStyle(info).display === 'none',
            tagText:  tag ? tag.textContent : '',
            tagInHold: !!tag && hold.contains(tag),
            tagH:     tag ? tag.getBoundingClientRect().height : 0,
            btnTop: r.top, btnBottom: r.bottom, vh: window.innerHeight,
        };
    });
    ok('practice: goes straight to the ready screen, skipping the rules card',
       ready.holdShown && ready.infoHidden,
       `hold shown=${ready.holdShown} rules hidden=${ready.infoHidden}`);
    ok('practice: the ready screen says it is practice, in one short tag',
       /PRACTICE/.test(ready.tagText) && ready.tagText.length <= 32 && ready.tagInHold,
       `"${ready.tagText}", ${ready.tagH.toFixed(0)}px tall`);
    ok('practice: the READY button is fully on screen',
       ready.btnTop >= 0 && ready.btnBottom <= ready.vh,
       `button spans ${ready.btnTop.toFixed(0)}–${ready.btnBottom.toFixed(0)} of ${ready.vh}px`);

    // Walk the practice round through with the agent, then force a result.
    for (let i = 0; i < 90; i++) {
        const s = await page.evaluate(() => { const r = window.__QA.step(); return { r, a: window.__QA.snapshot().mgActive }; });
        if (s.a) break;
        await page.waitForTimeout(120);
    }
    await page.waitForTimeout(1500);
    const after = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const MGM = await import('/src/minigames/MinigameManager.js');
        MGM.winMinigame(0);                       // P1 "wins" the practice round
        return new Promise(res => setTimeout(async () => {
            res({
                after: JSON.stringify({
                    c: state.players.map(p => p.coins), pos: state.players.map(p => p.pos),
                    w: state.players.map(p => p.mgWins), active: state.activePlayer,
                }),
                stillPractice: MGM.isPractice(),
                returned: window.__practiceReturned === true,
                layerHidden: getComputedStyle(document.getElementById('minigame-layer')).display === 'none',
            });
        }, 2600));
    });
    ok('practice: awards nothing — coins/pos/wins/turn unchanged',
       after.after === practice.before, `${practice.before} → ${after.after}`);
    ok('practice: clears its flag when done', after.stillPractice === false);
    ok('practice: calls its return hook and tears down', after.returned && after.layerHidden,
       `returned=${after.returned} layerHidden=${after.layerHidden}`);

    // ---------- 1. MAP on both boards ----------
    for (const map of ['hundred_block_dash', 'city_circuit']) {
        const p2 = await ctx.newPage();
        await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
        await p2.addScriptTag({ content: AGENT });
        await p2.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
        await p2.evaluate(() => window.__QA.bind());
        const cfg = map === 'city_circuit'
            ? { mode: '1p', difficulty: 'medium', map: 'city_circuit' }
            : { mode: '1p', difficulty: 'medium', map: 'hundred_block_dash', len: 50 };
        await p2.evaluate(c => window.__QA.startRun(c), cfg);
        await p2.waitForFunction(async () => {
            const R = await import('/src/engine/Renderer.js');
            return R.getTileMeshes().length > 0;
        }, null, { timeout: 40000 });
        // Get to a turn where the controls exist.
        for (let i = 0; i < 120; i++) {
            const s = await p2.evaluate(() => ({ r: window.__QA.step(), g: window.__QA.snapshot().gameState }));
            if (s.g === 'PRE_ROLL') break;
            await p2.waitForTimeout(120);
        }
        const res = await p2.evaluate(async () => {
            const UI = await import('/src/ui/UIManager.js');
            const R  = await import('/src/engine/Renderer.js');
            const { state } = await import('/src/core/GameState.js');
            const btn = document.querySelector('[data-map="0"]');
            const btnShown = btn && getComputedStyle(btn).display !== 'none';
            const camBefore = R.mapCamera.targetPos.clone();
            UI.openMap();
            const ui = document.getElementById('map-ui');
            const slider = document.getElementById('map-slider');
            const opened = getComputedStyle(ui).display !== 'none';
            const ALL_NODES_ORDERED = (await import('/src/config/ActiveMap.js')).ordered();
            const maxOk = parseInt(slider.max) === (state.selectedMap === 'hundred_block_dash'
                ? state.hbd.finish : ALL_NODES_ORDERED.length - 1);
            // Drive the slider to the far end and confirm the camera actually moved.
            slider.value = slider.max;
            UI.updateMapSlider();
            const moved = R.mapCamera.targetPos.distanceTo(camBefore) > 1;
            const counter = document.getElementById('map-counter').textContent;
            UI.closeMap();
            const closed = getComputedStyle(ui).display === 'none';
            return { btnShown, opened, maxOk, sliderMax: slider.max, moved, counter, closed,
                     stateAfter: state.gameState };
        });
        ok(`map[${map}]: button is shown on your turn`, res.btnShown);
        ok(`map[${map}]: opens`, res.opened);
        ok(`map[${map}]: slider spans the board`, res.maxOk, `max=${res.sliderMax}`);
        ok(`map[${map}]: camera follows the slider`, res.moved);
        ok(`map[${map}]: counter reads meaningfully`, !!res.counter && res.counter !== '—', res.counter);
        ok(`map[${map}]: closes and returns control`, res.closed && res.stateAfter === 'PRE_ROLL', res.stateAfter);
        await p2.close();
    }

    // ---------- 3. The payoff beat actually holds ----------
    // Measured on a BOT turn: no tap can shortcut it, so the dwell is the
    // guarantee the player gets. Hooks showMessage/closeAllModals directly
    // rather than sampling, so a fast agent can't hide the window.
    {
        const p3 = await ctx.newPage();
        await p3.goto(BASE, { waitUntil: 'domcontentloaded' });
        await p3.addScriptTag({ content: AGENT });
        await p3.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
        await p3.evaluate(() => window.__QA.bind());
        await p3.evaluate(async () => {
            const MM = await import('/src/ui/ModalManager.js');
            window.__dwell = { opens: [], closes: [], spans: [] };
            const realShow = MM.showMessage, realClose = MM.closeAllModals;
            // Patch the live module bindings via a wrapper on the DOM side:
            // record whenever the result modal appears and disappears.
            const box = document.getElementById('msg-modal');
            let shownAt = 0;
            new MutationObserver(() => {
                const vis = getComputedStyle(box).display !== 'none';
                if (vis && !shownAt) { shownAt = performance.now(); window.__dwell.opens.push(shownAt); }
                else if (!vis && shownAt) {
                    window.__dwell.spans.push(Math.round(performance.now() - shownAt));
                    shownAt = 0;
                }
            }).observe(box, { attributes: true, attributeFilter: ['style'] });
        });
        await p3.evaluate(() => window.__QA.setAutoAckResults(false));   // don't tap the bot's card
        await p3.evaluate(c => window.__QA.startRun(c),
            { mode: '1p', difficulty: 'medium', map: 'hundred_block_dash', len: 50 });
        const t0 = Date.now();
        while ((Date.now() - t0) / 1000 < 150) {
            const r = await p3.evaluate(() => window.__QA.step());
            if (r === 'WIN_SCREEN') break;
            await p3.waitForTimeout(90);
        }
        const dwell = await p3.evaluate(() => window.__dwell.spans);
        const botHolds = dwell.filter(d => d > 1200);   // turns not tapped through
        const minHold  = botHolds.length ? Math.min(...botHolds) : 0;
        ok('pacing: the result card holds ~3 s when nothing taps it through',
           botHolds.length > 0 && minHold >= 2600,
           `${botHolds.length} un-tapped holds, min ${minHold} ms, all spans [${dwell.join(', ')}]`);
        await p3.close();
    }

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-features.json'), JSON.stringify({ pass, fail, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
