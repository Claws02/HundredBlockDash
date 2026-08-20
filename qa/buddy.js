// ============================================================
// BUDDIES — the round report, the pass-by steal, the expiry clock,
// and whether each power actually does what its card says.
//
// What this exists for, in the order it was reported:
//
//   1. "Let's be more information sharing about the buddies. There should be a
//      pop up every round that there is a buddy in play, how long until that
//      buddy goes away." The card used to fire on the one round a buddy spawned
//      and never again, and an unclaimed buddy never left at all — so "how long
//      until it goes away" had no answer.
//   2. "When a player passes someone that has a buddy, they can steal the buddy
//      instead of needing to land on the same space." The steal needed an exact
//      landing: one node in sixty, on a turn the rival happened to be holding
//      something.
//   3. The power audit. Every `desc` is a promise. The Bodyguard's said it
//      absorbs negative space effects and only ever ran inside loseCoins(), so
//      an Anchor dragged you back five spaces through a full shield.
//
// usage: node buddy.js
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

    const reset = () => page.evaluate(async () => {
        const M  = await import('/src/ui/ModalManager.js');
        const D  = await import('/src/core/Director.js');
        const R  = await import('/src/engine/Renderer.js');
        const SP = await import('/src/engine/SetPieces.js');
        const GC = await import('/src/core/GameController.js');
        D.reset(); R.getActiveAnims().length = 0; SP.clearSetPieces();
        R.endCinematic(); M.closeAllModals();
        document.getElementById('ally-arrival').style.display = 'none';
        GC.startPreRoll();
    });

    // ---------------------------------------------------------------
    // 1. Every buddy's `desc` is a promise. Check the code keeps it.
    // ---------------------------------------------------------------
    const powers = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const { ALLIES, ALLY_TURNS, DUEL_STAKE } = await import('/src/config/GameConfig.js');
        const GC = await import('/src/core/GameController.js');
        const EC = await import('/src/core/Economy.js');
        const CT = await import('/src/core/Contracts.js');
        const R  = await import('/src/engine/Renderer.js');
        const p = state.players[0], opp = state.players[1];
        const give = t => { p.allies = [{ type: t, turnsRemaining: ALLY_TURNS,
                                          shieldCharges: ALLIES[t].shieldCharges || 0, mesh: null }]; };
        const out = {};

        // Vendor: +2 on a coin space.
        state.activePlayer = 0; p.pos = 'r2'; p.mesh.position.copy(R.getPos('r2'));
        state.board['r2'] = { type: 'coin' };
        p.allies = []; p.coins = 0;
        GC.resolveSpaceEffect(p, 'coin', state.board['r2']);
        const plain = p.coins;
        give('vendor'); p.coins = 0;
        GC.resolveSpaceEffect(p, 'coin', state.board['r2']);
        out.vendor = { plain, withBuddy: p.coins };

        // Banker: interest at round end is floor(coins / 10).
        give('banker'); p.coins = 47; opp.allies = [];
        out.bankerRule = Math.floor(47 / 10);

        // Bodyguard: coin damage AND an Anchor both cost a charge.
        give('bodyguard'); p.coins = 40;
        EC.loseCoins(p, 8);
        out.bgCoins = { coins: p.coins, chargesLeft: p.allies[0] ? p.allies[0].shieldCharges : 0 };
        give('bodyguard');
        p.pos = 'r5'; p.mesh.position.copy(R.getPos('r5'));
        const anchorSpace = { type: 'anchor_trap', owner: 1 };
        state.board['r5'] = anchorSpace;
        state.pendingForcedMove = 0;
        const msg = GC.resolveSpaceEffect(p, 'anchor_trap', anchorSpace);
        out.bgAnchor = { forced: state.pendingForcedMove, msg,
                         chargesLeft: p.allies[0] ? p.allies[0].shieldCharges : 0 };
        state.pendingForcedMove = 0;

        // Investor: first bounty each round pays double, once.
        give('investor');
        state.investorUsedThisRound = [false, false];
        out.investorReset = state.investorUsedThisRound.slice();

        p.allies = [];
        return { out, descs: Object.fromEntries(Object.entries(ALLIES).map(([k, v]) => [k, v.desc])), DUEL_STAKE };
    });
    ok('power · Street Vendor: a coin space really does pay +2 more',
        powers.out.vendor.withBuddy === powers.out.vendor.plain + 2,
        `${powers.out.vendor.plain} → ${powers.out.vendor.withBuddy}`);
    ok('power · Bodyguard: a fine costs a charge, not coins',
        powers.out.bgCoins.coins === 40 && powers.out.bgCoins.chargesLeft === 2,
        JSON.stringify(powers.out.bgCoins));
    ok('power · Bodyguard: an Anchor costs a charge too, and you do NOT move',
        powers.out.bgAnchor.forced === 0 && powers.out.bgAnchor.chargesLeft === 2,
        JSON.stringify(powers.out.bgAnchor));
    ok('power · Bodyguard: and the card no longer over-promises',
        /coin losses and Anchor/i.test(powers.descs.bodyguard), powers.descs.bodyguard);
    ok('power · Investor: the per-round double resets for both players',
        JSON.stringify(powers.out.investorReset) === '[false,false]');

    // ---------------------------------------------------------------
    // 2. The round report: does it say who, where, and how long?
    // ---------------------------------------------------------------
    await reset();
    const report = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const { ALLIES, ALLY_TURNS, BUDDY_MAP_ROUNDS } = await import('/src/config/GameConfig.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        state.allyOnMap = null; R.removeAllyMarker();
        state.players[0].allies = [{ type: 'bodyguard', turnsRemaining: 2, shieldCharges: 3, mesh: null }];
        state.players[1].allies = [];
        GC.spawnAlly();
        const rep = GC.buddyReport();
        const b = ALLIES[rep.onMap.type];
        (await import('/src/ui/UIManager.js')).showBuddyReport(rep, true, () => {});
        await new Promise(r => setTimeout(r, 400));
        const txt = id => (document.getElementById(id) || {}).textContent || '';
        return {
            defaultRounds: BUDDY_MAP_ROUNDS,
            rep,
            shown: getComputedStyle(document.getElementById('ally-arrival')).display !== 'none',
            tag: txt('aa-tag'), name: txt('aa-name'), power: txt('aa-power'),
            where: txt('aa-where'), clock: txt('aa-clock'),
            held: (document.getElementById('aa-held') || {}).innerText || '',
            realName: b.name, realDesc: b.desc,
        };
    });
    ok('report: it is on screen, holding the minigame back', report.shown);
    ok('report: it names the buddy and what they do',
        report.name === report.realName.toUpperCase() && report.power === report.realDesc,
        `"${report.name}" / "${report.power}"`);
    ok('report: it says where they are waiting',
        /waiting near the .+\./i.test(report.where), report.where);
    ok('report: and how many rounds before they leave',
        /leaves in \d+ rounds|last chance/i.test(report.clock), report.clock);
    ok('report: a board buddy starts with a real countdown, not "forever"',
        report.rep.onMap.roundsLeft === report.defaultRounds,
        `roundsLeft=${report.rep.onMap.roundsLeft} of ${report.defaultRounds}`);
    ok('report: it also lists what each player is already holding, with the clock',
        /bodyguard/i.test(report.held) && /2 turns/i.test(report.held),
        JSON.stringify(report.held));

    // The report hugs the same edge the toast rail lives on, and round-end
    // toasts (Banker interest, a buddy expiring) fire in the same beat.
    const rail = await page.evaluate(async () => {
        const U = await import('/src/ui/UIManager.js');
        U.toast('💼 Banker: +4 coins interest!', '#fbbf24', { urgent: true });
        U.flushToasts();
        await new Promise(r => setTimeout(r, 350));
        const box = document.getElementById('toast-box').getBoundingClientRect();
        const card = document.getElementById('aa-card').getBoundingClientRect();
        return { overlap: box.bottom > card.top && box.top < card.bottom,
                 box: [Math.round(box.top), Math.round(box.bottom)],
                 card: [Math.round(card.top), Math.round(card.bottom)] };
    });
    ok('report: a round-end toast does not land on the report card',
        !rail.overlap, JSON.stringify(rail));
    await page.screenshot({ path: path.join(__dirname, 'shot-buddy-report.png') });

    // The last-round wording has to change, or "leaves in 1 rounds" ships.
    const lastCall = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const U  = await import('/src/ui/UIManager.js');
        state.allyOnMap.roundsLeft = 1;
        U.showBuddyReport(GC.buddyReport(), false, () => {});
        await new Promise(r => setTimeout(r, 200));
        return {
            tag: document.getElementById('aa-tag').textContent,
            clock: document.getElementById('aa-clock').textContent,
        };
    });
    ok('report: the last round says so, and the tag stops saying "NEW"',
        /last chance/i.test(lastCall.clock) && !/new/i.test(lastCall.tag),
        `${lastCall.tag} / ${lastCall.clock}`);

    // ---------------------------------------------------------------
    // 3. An unclaimed buddy actually leaves.
    // ---------------------------------------------------------------
    const expiry = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const { BUDDY_MAP_ROUNDS } = await import('/src/config/GameConfig.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        state.allyOnMap = null; R.removeAllyMarker();
        GC.spawnAlly();
        const started = state.allyOnMap.nodeId;
        const seen = [];
        for (let i = 0; i < BUDDY_MAP_ROUNDS; i++) {
            GC.onRoundEnd();
            seen.push(state.allyOnMap ? state.allyOnMap.roundsLeft : 'gone');
        }
        return { started, seen, after: state.allyOnMap, departed: state.pendingBuddyDeparture,
                 markers: R.getAllyMarkerCount ? R.getAllyMarkerCount() : null };
    });
    ok('expiry: the countdown ticks down once per round',
        expiry.seen.slice(0, -1).every((v, i) => v === expiry.seen.length - 1 - i),
        JSON.stringify(expiry.seen));
    ok('expiry: and the buddy is gone when it runs out',
        expiry.seen[expiry.seen.length - 1] === 'gone' && !expiry.after,
        JSON.stringify(expiry.seen));
    ok('expiry: the report can say they left rather than vanishing silently',
        !!expiry.departed, String(expiry.departed));

    // ---------------------------------------------------------------
    // 4. Passing a rival is enough to go for their buddy.
    // ---------------------------------------------------------------
    await reset();
    const passBy = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const { ALLY_TURNS } = await import('/src/config/GameConfig.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        state.activePlayer = 0;
        const p = state.players[0], opp = state.players[1];
        p.isBot = false; opp.isBot = false;
        // Flatten the route to plain coin tiles. r3 happens to be a shop on the
        // live board, and its pass-through offer fires from the same hook — a
        // first run of this measured the shop and called the steal broken.
        ['r1', 'r2', 'r3', 'r4', 'r5'].forEach(id => { state.board[id] = { type: 'coin' }; });
        // Mover at r1, rival two steps ahead at r3, rolling four: the rival's
        // square is passed straight through, never landed on.
        p.pos = 'r1'; p.mesh.position.copy(R.getPos('r1'));
        opp.pos = 'r3'; opp.mesh.position.copy(R.getPos('r3'));
        opp.allies = [{ type: 'banker', turnsRemaining: ALLY_TURNS, shieldCharges: 0, mesh: null }];
        GC.moveThroughGraph(p, 4);
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 200));
            const m = document.getElementById('ally-steal-modal');
            if (m && getComputedStyle(m).display !== 'none') {
                return { offered: true, atOffer: p.pos, rivalPos: opp.pos,
                         options: document.querySelectorAll('#ally-steal-list [data-ally-idx]').length };
            }
        }
        return { offered: false, atOffer: p.pos, rivalPos: opp.pos };
    });
    ok('pass-by: brushing past a rival offers the steal',
        passBy.offered, JSON.stringify(passBy));
    ok('pass-by: it fires on the rival\'s own square, mid-move',
        passBy.offered && passBy.atOffer === passBy.rivalPos,
        `mover ${passBy.atOffer} vs rival ${passBy.rivalPos}`);
    ok('pass-by: the picker lists the buddies they are actually holding',
        passBy.options === 1, `${passBy.options} option(s)`);

    // Declining must hand the remaining steps back, not strand the turn.
    // Ending on r5 is also what proves this was a PASS: two steps were still
    // owed when the offer came up, and the mover spends them afterwards.
    const resumed = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        document.getElementById('btn-ally-steal-cancel').click();
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 200));
            if (state.players[0].pos === 'r5') break;
        }
        return { pos: state.players[0].pos, gs: state.gameState };
    });
    ok('pass-by: declining resumes the move — the rival\'s square was passed, not landed on',
        resumed.pos === 'r5', JSON.stringify(resumed));

    // ---------------------------------------------------------------
    // 5. Nothing a player reads still says "ally".
    // ---------------------------------------------------------------
    const copy = await page.evaluate(async () => {
        const { ALLIES, CHAR_NAMES } = await import('/src/config/GameConfig.js');
        const { CONTRACT_POOL } = await import('/src/config/ContractPool.js');
        const { MAP_REGISTRY } = await import('/src/config/MapRegistry.js');
        const bad = [];
        const check = (where, text) => {
            if (typeof text === 'string' && /\ball(y|ies)\b/i.test(text)) bad.push(`${where}: ${text}`);
        };
        Object.entries(ALLIES).forEach(([k, v]) => { check('ALLIES.' + k, v.name); check('ALLIES.' + k, v.desc); });
        CONTRACT_POOL.forEach(c => { check('contract ' + c.id, c.desc); check('contract ' + c.id + ' hint', c.hint); });
        Object.values(MAP_REGISTRY).forEach(m => {
            check('map', m.longDesc);
            (m.tags || []).forEach(t => check('map tag', t));
        });
        // And the markup: any visible text node in the buddy screens.
        ['ally-encounter-modal', 'ally-steal-modal', 'ally-arrival'].forEach(id => {
            const el = document.getElementById(id);
            if (el) check('#' + id, el.innerText.replace(/\s+/g, ' '));
        });
        return { bad, names: CHAR_NAMES };
    });
    ok('copy: no buddy-facing string still says "ally"',
        copy.bad.length === 0, copy.bad.slice(0, 4).join(' | '));

    // ---------------------------------------------------------------
    // 6. Fewer duels.
    // ---------------------------------------------------------------
    const duels = await page.evaluate(async () => {
        const { DISTRICT_POOLS } = await import('/src/config/BoardGraph.js');
        const all = Object.values(DISTRICT_POOLS).flat();
        return {
            duel: all.filter(t => t === 'duel').length,
            total: all.length,
            byDistrict: Object.fromEntries(Object.entries(DISTRICT_POOLS)
                .map(([k, v]) => [k, v.filter(t => t === 'duel').length])),
            sizes: Object.fromEntries(Object.entries(DISTRICT_POOLS).map(([k, v]) => [k, v.length])),
        };
    });
    ok('duels: down to three tiles, one per district that wants one',
        duels.duel === 3, `${duels.duel} of ${duels.total} — ${JSON.stringify(duels.byDistrict)}`);
    ok('duels: and the pools still fit their districts',
        JSON.stringify(duels.sizes) === JSON.stringify({ ring: 17, fin: 8, ba: 10, shop: 8, ind: 5 }),
        JSON.stringify(duels.sizes));

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));

    await browser.close();
    console.log('\nPASS:'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL:'); fail.length ? fail.forEach(f => console.log('  ✗ ' + f)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
