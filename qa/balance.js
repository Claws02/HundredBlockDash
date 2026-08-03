// ============================================================
// Board balance + forced-move notifications.
//
//   A. no more than one coin-LOSING space per 10 blocks, at every board length
//   B. the ±10 launch/pullback spaces announce themselves before they move you
//   C. picking up an item is a card you have to acknowledge, named after the item
//
// (B) and (C) were silent before: the board moved you and the only thing you
// saw was the result of wherever you landed.
//
// usage: node balance.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

// Spaces that take coins OFF the player who lands on them. `magnet` is
// deliberately not here: landing on it steals coins FROM the opponent, so it is
// a reward, not a tax. `anchor_trap` drags you back but costs nothing.
// `player_trap` (Tollbooth) is player-placed via an item and never generated —
// it is listed so a regression that starts generating it would be caught.
const LOSING = ['lose', 'lose_big', 'trap', 'player_trap'];

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

    // ── A. red-space density, sampled across many generated boards ───────────
    // The layout is randomised per match, so one board proves nothing. 40 seeds
    // per length, and the cap has to hold on the worst of them.
    const density = await page.evaluate(async (losing) => {
        const BS = await import('/src/core/BoardSetup.js');
        const GCfg = await import('/src/config/GameConfig.js');
        const { state } = await import('/src/core/GameState.js');
        const out = {};
        for (const len of [50, 75, 100]) {
            let worstRatio = 0, worst = null, totals = [];
            for (let s = 0; s < 40; s++) {
                state.selectedMap = 'hundred_block_dash';
                state.hbdLength = len;
                state.hbd = GCfg.buildHbdConfig(len);
                GCfg.setHbdRealmCount(state.hbd.realmCount);
                BS.generateBoard();
                let red = 0, spaces = 0;
                for (const k of Object.keys(state.board)) {
                    const t = state.board[k].type;
                    spaces++;
                    if (losing.includes(t)) red++;
                }
                totals.push(red);
                const ratio = red / len;
                if (ratio > worstRatio) { worstRatio = ratio; worst = { red, spaces }; }
            }
            out[len] = {
                worstRed: worst.red, spaces: worst.spaces, len,
                worstOnePer: +(len / Math.max(1, worst.red)).toFixed(1),
                meanRed: +(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1),
                cap: Math.floor(len / 10),
            };
        }
        return out;
    }, LOSING);

    for (const len of [50, 75, 100]) {
        const d = density[len];
        ok(`balance[${len}]: at most 1 coin-losing space per 10 blocks`,
           d.worstRed <= d.cap,
           `worst of 40 boards: ${d.worstRed} red (cap ${d.cap}) = 1 per ${d.worstOnePer}; mean ${d.meanRed}`);
    }

    // ── Boot a real match so the notification checks run against live UI ──────
    await page.evaluate(() => window.__QA.startRun({ mode: 'tabletop', map: 'hundred_block_dash', len: 50 }));
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 90000) {
        ready = await page.evaluate(async () => {
            const { state } = await import('/src/core/GameState.js');
            return !!state.hbd && state.gameState === 'PRE_ROLL';
        });
        if (ready) break;
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(250);
    }
    ok('boot: match is running', ready);
    if (!ready) { console.log('FAIL: never reached PRE_ROLL'); await browser.close(); process.exit(1); }

    // Land the active player on a space of a given type and read the card.
    const land = async (type, at) => page.evaluate(async ({ type, at }) => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const R = await import('/src/engine/Renderer.js');
        state.activePlayer = 0;
        const p = state.players[0];
        p.pos = at; p.prevPos = at;
        if (p.mesh) p.mesh.position.copy(R.getPos(at));
        state.board[at] = { type };
        state.gameState = 'MOVING';
        GC.resolveSpace(p);
        return { at };
    }, { type, at });

    const readCard = () => page.evaluate(() => {
        const box = document.getElementById('msg-modal');
        const shown = box && getComputedStyle(box).display !== 'none'
                      && getComputedStyle(document.getElementById('modal-overlay')).display !== 'none';
        return {
            shown: !!shown,
            title: (document.getElementById('msg-title') || {}).innerText || '',
            body: (document.getElementById('msg-desc') || {}).innerText || '',
        };
    });
    const posOf = () => page.evaluate(async () =>
        (await import('/src/core/GameState.js')).state.players[0].pos);
    const ack = () => page.evaluate(async () =>
        (await import('/src/core/GameController.js')).resolveMsgModal());
    // The forced walk is ten animated hops, so poll rather than guess a delay.
    const settleAt = async (want) => {
        const until = Date.now() + 15000;
        let cur = await posOf();
        while (Date.now() < until && cur !== want) {
            await page.waitForTimeout(300);
            cur = await posOf();
        }
        return cur;
    };

    // ── B1. launch forward 10 ────────────────────────────────────────────────
    await land('cfwd', 8);
    await page.waitForTimeout(900);            // LAND_SETTLE floor is 420 ms
    const cfwdCard = await readCard();
    ok('cfwd: the +10 launch announces itself before moving you',
       cfwdCard.shown && /10 spaces forward/i.test(cfwdCard.body),
       `"${cfwdCard.title}" / "${cfwdCard.body.replace(/\n/g, ' ')}"`);
    const posBeforeF = await posOf();
    await ack();
    const posAfterF = await settleAt(18);
    ok('cfwd: the move happens after you acknowledge it, not before',
       posBeforeF === 8 && posAfterF === 18, `${posBeforeF} → ${posAfterF}`);

    // ── B2. pulled back 10 ───────────────────────────────────────────────────
    await land('cbwd', 30);
    await page.waitForTimeout(900);
    const cbwdCard = await readCard();
    ok('cbwd: the −10 pullback announces itself before moving you',
       cbwdCard.shown && /10 spaces backward/i.test(cbwdCard.body),
       `"${cbwdCard.title}" / "${cbwdCard.body.replace(/\n/g, ' ')}"`);
    const posBeforeB = await posOf();
    await ack();
    const posAfterB = await settleAt(20);
    ok('cbwd: the move happens after you acknowledge it',
       posBeforeB === 30 && posAfterB === 20, `${posBeforeB} → ${posAfterB}`);

    // ── C. item pickup is a named confirmation ───────────────────────────────
    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        state.players[0].inv = [];              // room to receive
    });
    await land('mystery', 12);
    await page.waitForTimeout(900);
    const itemCard = await readCard();
    const inv = await page.evaluate(async () =>
        (await import('/src/core/GameState.js')).state.players[0].inv.slice());
    ok('item: pickup raises a card you must press to continue',
       itemCard.shown && /^YOU GOT:/.test(itemCard.title),
       `"${itemCard.title}"`);
    ok('item: the card names the item and says where it went',
       inv.length === 1 && itemCard.title.includes(String(inv[0]).toUpperCase().slice(0, 4))
         || /ITEMS on your turn/i.test(itemCard.body),
       `inv=${JSON.stringify(inv)} body="${itemCard.body.replace(/\n/g, ' ')}"`);
    const stillWaiting = await page.evaluate(async () =>
        (await import('/src/core/GameState.js')).state.gameState);
    ok('item: the game waits on that card instead of moving on',
       stillWaiting === 'ACKNOWLEDGE', `gameState=${stillWaiting}`);

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-balance.json'),
        JSON.stringify({ pass, fail, density, cfwdCard, cbwdCard, itemCard, inv, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
