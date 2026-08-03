// ============================================================
// Dual read — can both players actually read the message?
//
//   SHARED cards (minigame rules, gate result, minigame outcome) are drawn
//   twice in tabletop mode, the top copy rotated 180°, and the minigame rules
//   need BOTH players to confirm.
//   OWNER cards (space result, item pickup) stay full size for the turn-taker
//   and put a mirrored headline strip on the opponent's edge.
//   The ⟳ flip button rides on every non-mirrored card, in every mode.
//
// Runs the same checks in tabletop and pass-and-play, because pass-and-play is
// explicitly meant to get the flip button but NOT the mirroring.
//
// usage: node dualread.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

// A copy is readable by the far player if it is rotated a half turn relative to
// the original. Read the angle out of the matrix rather than string-matching:
// these transforms are animated, so a sample can land mid-tween.
function angleOf(t) {
    const m = /matrix\(([^)]+)\)/.exec(t || '');
    if (!m) return 0;
    const [a, b] = m[1].split(',').map(Number);
    return Math.abs(Math.atan2(b, a) * 180 / Math.PI);
}
const isHalfTurn = t => Math.abs(angleOf(t) - 180) < 8;

async function boot(page, mode) {
    await page.evaluate(m => window.__QA.startRun({ mode: m, map: 'hundred_block_dash', len: 50 }), mode);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
        const r = await page.evaluate(async () => {
            const { state } = await import('/src/core/GameState.js');
            return !!state.hbd && state.gameState === 'PRE_ROLL';
        });
        if (r) return true;
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(250);
    }
    return false;
}

// Land the active player on a space type and let the result card appear.
const land = (page, type, at, who = 0) => page.evaluate(async ({ type, at, who }) => {
    const { state } = await import('/src/core/GameState.js');
    const GC = await import('/src/core/GameController.js');
    const R = await import('/src/engine/Renderer.js');
    state.activePlayer = who;
    const p = state.players[who];
    p.pos = at; p.prevPos = at;
    if (p.mesh) p.mesh.position.copy(R.getPos(at));
    state.board[at] = { type };
    state.gameState = 'MOVING';
    GC.resolveSpace(p);
}, { type, at, who });

const readCards = page => page.evaluate(() => {
    const ov = document.getElementById('modal-overlay');
    const real = document.getElementById('msg-modal');
    const mirror = ov.querySelector('.dual-mirror');
    const vis = el => el && getComputedStyle(el).display !== 'none';
    const tick = document.getElementById('opp-ticker');
    return {
        realShown:    vis(real),
        realRot:      getComputedStyle(real).transform,
        mirrorShown:  vis(mirror),
        mirrorRot:    mirror ? getComputedStyle(mirror).transform : '',
        mirrorText:   mirror ? mirror.innerText.replace(/\n/g, ' ').trim().slice(0, 60) : '',
        realText:     real.innerText.replace(/\n/g, ' ').trim().slice(0, 60),
        dualMode:     ov.classList.contains('dual-mode'),
        flipBtn:      !!real.querySelector(':scope > .card-flip-btn') &&
                      getComputedStyle(real.querySelector(':scope > .card-flip-btn')).display !== 'none',
        mirrorHasFlip: !!(mirror && mirror.querySelector('.card-flip-btn')),
        // A duplicated id would make every getElementById in the game resolve
        // to the copy, because the mirror sits BEFORE the original.
        dupIds:       mirror ? mirror.querySelectorAll('[id]').length : 0,
        tickerShown:  vis(tick),
        tickerText:   tick ? tick.innerText.replace(/\n/g, ' ').trim() : '',
        tickerRot:    tick ? getComputedStyle(tick).transform : '',
        hint:         vis(document.getElementById('flip-hint')),
    };
});

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

    // ════════════════════ TABLETOP ════════════════════
    ok('boot: tabletop match running', await boot(page, 'tabletop'));

    // ---- OWNER tier: space result ----
    await land(page, 'coin', 6, 0);
    await page.waitForTimeout(1000);
    const owner = await readCards(page);
    ok('owner: the turn-taker gets one full-size card', owner.realShown && !owner.mirrorShown,
       `real=${owner.realShown} mirror=${owner.mirrorShown} "${owner.realText}"`);
    ok('owner: the opponent gets a headline strip on their own edge',
       owner.tickerShown, `"${owner.tickerText}"`);
    ok('owner: that strip faces the opponent (P1 acting → strip rotated for P2)',
       isHalfTurn(owner.tickerRot), owner.tickerRot);
    ok('owner: the card carries the ⟳ flip button', owner.flipBtn);
    ok('hint: the note appears the first time a flip button shows', owner.hint);
    await page.screenshot({ path: path.join(__dirname, 'shot-dual-owner.png') });

    // The flip button actually flips the card.
    const beforeFlip = owner.realRot;
    await page.evaluate(() => document.querySelector('#msg-modal > .card-flip-btn')
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));
    await page.waitForTimeout(500);
    const afterFlip = await page.evaluate(() => ({
        rot: getComputedStyle(document.getElementById('msg-modal')).transform,
        cls: document.getElementById('msg-modal').className,
        hint: getComputedStyle(document.getElementById('flip-hint')).display,
    }));
    ok('flip: the button turns the card a half turn',
       isHalfTurn(afterFlip.rot) && !isHalfTurn(beforeFlip),
       `${beforeFlip} → ${afterFlip.rot}`);
    ok('flip: using it dismisses the note', afterFlip.hint === 'none');

    // ---- OWNER tier from Player 2: the strip moves to the other edge ----
    await page.evaluate(async () => (await import('/src/core/GameController.js')).resolveMsgModal());
    await page.waitForTimeout(1200);
    await land(page, 'coin_big', 9, 1);
    await page.waitForTimeout(1000);
    const owner2 = await readCards(page);
    ok('owner: with P2 acting the strip moves to P1\'s edge and stops rotating',
       owner2.tickerShown && !isHalfTurn(owner2.tickerRot),
       `transform=${owner2.tickerRot} "${owner2.tickerText}"`);

    // ---- SHARED tier: the gate result ----
    await page.evaluate(async () => (await import('/src/core/GameController.js')).resolveMsgModal());
    await page.waitForTimeout(1200);
    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const M = await import('/src/ui/ModalManager.js');
        state.activePlayer = 0;
        M.showMessage('🔓 GATE OPEN!', 'The Gate is open! Both players may now pass through.', '🔓',
                      { tier: 'shared' });
    });
    await page.waitForTimeout(500);
    const shared = await readCards(page);
    ok('shared: the card is drawn twice', shared.realShown && shared.mirrorShown && shared.dualMode,
       `real=${shared.realShown} mirror=${shared.mirrorShown} dual-mode=${shared.dualMode}`);
    ok('shared: the second copy is rotated for the far player',
       isHalfTurn(shared.mirrorRot) && !isHalfTurn(shared.realRot),
       `mirror=${shared.mirrorRot} real=${shared.realRot}`);
    ok('shared: both copies say the same thing',
       shared.mirrorText === shared.realText.replace(/^⟳\s*/, ''),
       `"${shared.realText}" vs "${shared.mirrorText}"`);
    ok('shared: the copy carries no duplicate ids', shared.dupIds === 0, `${shared.dupIds} ids`);
    ok('shared: a mirrored card drops the flip button (it would do nothing)',
       !shared.flipBtn && !shared.mirrorHasFlip);
    ok('shared: no headline strip on top of a card both can already read',
       !shared.tickerShown);
    await page.screenshot({ path: path.join(__dirname, 'shot-dual-shared.png') });

    // Pressing CONTINUE on the *copy* must drive the real button.
    const before = await page.evaluate(async () =>
        (await import('/src/core/GameState.js')).state.msgModalResolving);
    await page.evaluate(() => {
        const b = document.querySelector('#modal-overlay .dual-mirror [data-dual-id]');
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(600);
    const closed = await page.evaluate(() =>
        getComputedStyle(document.getElementById('modal-overlay')).opacity);
    ok('shared: pressing the far player\'s copy works the real button',
       before === false && closed === '0', `overlay opacity ${closed}`);

    // ---- SHARED tier: the minigame rules, with dual confirm ----
    await page.waitForTimeout(1200);
    await page.evaluate(async () => {
        const MM = await import('/src/minigames/MinigameManager.js');
        MM.trigger(() => {});
    });
    // The game-name slot machine runs on a 100 ms interval that drifts badly
    // under software GL, so wait for the card to actually settle.
    // mg-step-0 goes `done` at the moment the game is chosen and the real card
    // is built. The button text is not a signal — it reads GOT IT throughout.
    await page.waitForFunction(
        () => document.getElementById('mg-step-0').classList.contains('done'),
        null, { timeout: 25000 });
    await page.waitForTimeout(500);
    const intro = await page.evaluate(() => {
        const host = document.getElementById('mg-intro-content');
        const info = document.getElementById('mg-page-info');
        const mirror = host.querySelector('.dual-mirror');
        return {
            dualMode: host.classList.contains('dual-mode'),
            mirrorShown: !!mirror && getComputedStyle(mirror).display !== 'none',
            mirrorRot: mirror ? getComputedStyle(mirror).transform : '',
            title: (document.getElementById('mg-intro-title') || {}).innerText || '',
            mirrorTitle: mirror ? (mirror.querySelector('[data-mirror-id="mg-intro-title"]') || {}).innerText || '' : '',
            btn: (document.getElementById('btn-mg-intro-next') || {}).innerText || '',
            note: (document.getElementById('mg-intro-ready-note') || {}).innerText || '',
            dupIds: mirror ? mirror.querySelectorAll('[id]').length : 0,
            infoShown: getComputedStyle(info).display !== 'none',
        };
    });
    ok('rules: the explanation is drawn for both players',
       intro.dualMode && intro.mirrorShown && isHalfTurn(intro.mirrorRot),
       `dual=${intro.dualMode} shown=${intro.mirrorShown} rot=${intro.mirrorRot}`);
    ok('rules: both copies name the same game',
       !!intro.title && intro.mirrorTitle === intro.title, `"${intro.title}" vs "${intro.mirrorTitle}"`);
    ok('rules: the copy carries no duplicate ids', intro.dupIds === 0, `${intro.dupIds} ids`);
    ok('rules: both players are asked to confirm', /both players/i.test(intro.note), `"${intro.note}"`);
    await page.screenshot({ path: path.join(__dirname, 'shot-dual-intro.png') });

    // One press must NOT advance.
    await page.evaluate(() => document.getElementById('btn-mg-intro-next')
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));
    await page.waitForTimeout(500);
    const afterOne = await page.evaluate(() => ({
        infoShown: getComputedStyle(document.getElementById('mg-page-info')).display !== 'none',
        holdShown: getComputedStyle(document.getElementById('mg-page-hold')).display !== 'none',
        btn: (document.getElementById('btn-mg-intro-next') || {}).innerText || '',
        note: (document.getElementById('mg-intro-ready-note') || {}).innerText || '',
        mirrorBtn: (document.querySelector('#mg-intro-content .dual-mirror [data-mirror-id="btn-mg-intro-next"]') || {}).innerText || '',
    }));
    ok('DUAL CONFIRM: one player alone cannot skip the rules',
       afterOne.infoShown && !afterOne.holdShown, `info=${afterOne.infoShown} hold=${afterOne.holdShown}`);
    ok('DUAL CONFIRM: that player\'s side shows as ready and waits',
       /READY/i.test(afterOne.btn) && /waiting/i.test(afterOne.note),
       `btn="${afterOne.btn}" note="${afterOne.note}"`);
    ok('DUAL CONFIRM: the other player\'s side still shows GOT IT',
       /GOT IT/i.test(afterOne.mirrorBtn), `mirror btn="${afterOne.mirrorBtn}"`);

    // Second press, from the far copy, advances.
    await page.evaluate(() => {
        const b = document.querySelector('#mg-intro-content .dual-mirror [data-dual-id]');
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(600);
    const afterBoth = await page.evaluate(() => {
        const host = document.getElementById('mg-intro-content');
        const mirrors = [...host.querySelectorAll('.dual-mirror')]
            .filter(m => getComputedStyle(m).display !== 'none');
        return {
            infoShown: getComputedStyle(document.getElementById('mg-page-info')).display !== 'none',
            holdShown: getComputedStyle(document.getElementById('mg-page-hold')).display !== 'none',
            liveMirrors: mirrors.length,
            holdMirrored: mirrors.some(m => m.querySelector('[data-mirror-id="orient-name"]')),
        };
    });
    ok('DUAL CONFIRM: both confirmations advance the intro',
       !afterBoth.infoShown && afterBoth.holdShown,
       `info=${afterBoth.infoShown} hold=${afterBoth.holdShown}`);
    ok('rules: the rules copy does not outlive the rules page',
       afterBoth.liveMirrors === 1 && afterBoth.holdMirrored,
       `${afterBoth.liveMirrors} live mirror(s), hold mirrored=${afterBoth.holdMirrored}`);
    await page.screenshot({ path: path.join(__dirname, 'shot-dual-rules.png') });

    // ════════════════════ PASS AND PLAY ════════════════════
    // Same build, different contract: flip button yes, mirroring no.
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());
    ok('boot: pass-and-play match running', await boot(page, 'pass'));

    await page.evaluate(async () => {
        const M = await import('/src/ui/ModalManager.js');
        M.showMessage('🔓 GATE OPEN!', 'The Gate is open! Both players may now pass through.', '🔓',
                      { tier: 'shared' });
    });
    await page.waitForTimeout(500);
    const pp = await readCards(page);
    ok('pass-and-play: a shared card is NOT mirrored (the device gets handed over)',
       !pp.mirrorShown && !pp.dualMode, `mirror=${pp.mirrorShown} dual-mode=${pp.dualMode}`);
    ok('pass-and-play: it still gets the ⟳ flip button', pp.flipBtn);
    ok('pass-and-play: no opponent strip', !pp.tickerShown);

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-dualread.json'),
        JSON.stringify({ pass, fail, owner, owner2, shared, intro, afterOne, afterBoth, pp,
                         errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
